import { StorageManager } from '../storage/storageManager';
import { BookmarkManager } from '../bookmarks/bookmarkManager';
import { TabGroupManager } from '../tabGroupManager';
import { getTabsInGroup } from '../utils/tabUtils';
import { SyncError, ErrorType, withErrorHandling } from '../utils/errors';
import { Logger, withRetry, OperationTracker } from '../utils/logger';
import { BookmarkFolderId, RuntimeMapping, RuntimeMappingUpdate } from '../types/storage';

// Sync queue to prevent hitting Chrome storage quota
interface QueuedSync {
  name: string;
  timestamp: number;
  retryCount?: number;
}

export class SyncEngine {
  private logger = Logger.getInstance();
  private tracker = OperationTracker.getInstance();
  private syncQueue: QueuedSync[] = [];
  private processingQueue = false;
  private readonly SYNC_DELAY = 4000; // 4 seconds between syncs
  private lastKnownHashes: Map<string, string> = new Map();
  private readonly MAX_QUEUE_SIZE = 100;
  private readonly MAX_RETRIES = 3;

  constructor(
    private storage: StorageManager,
    private bookmarkManager: BookmarkManager,
    private tabGroupManager: TabGroupManager
  ) {
    this.logger.info('SyncEngine:init', { timestamp: Date.now() });
  }

  // Process sync queue
  private async processSyncQueue() {
    if (this.processingQueue || this.syncQueue.length === 0) return;
    
    this.processingQueue = true;
    try {
      while (this.syncQueue.length > 0) {
        const item = this.syncQueue.shift()!;
        
        try {
          await this.syncGroupToFolder(item.name);
          this.logger.info('syncQueue:processed', { 
            name: item.name,
            queueLength: this.syncQueue.length
          });
        } catch (error) {
          const isQuotaError = error instanceof Error && 
            error.message.includes('MAX_WRITE_OPERATIONS_PER_HOUR');
          
          if (isQuotaError && (!item.retryCount || item.retryCount < this.MAX_RETRIES)) {
            // Put back in queue with longer delay for quota errors
            this.syncQueue.push({
              ...item,
              retryCount: (item.retryCount || 0) + 1,
              timestamp: Date.now() + 60000 // Retry after 1 minute
            });
            this.logger.warn('syncQueue:quotaError', {
              name: item.name,
              retryCount: item.retryCount,
              delay: '1 minute'
            });
            // Take a break when hitting quota
            await new Promise(resolve => setTimeout(resolve, 60000));
          } else {
            this.logger.error('syncQueue:syncFailed', {
              name: item.name,
              error: error instanceof Error ? error.message : 'Unknown error',
              retryCount: item.retryCount
            });
          }
        }
        
        // Wait between syncs to avoid hitting quota
        if (this.syncQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, this.SYNC_DELAY));
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  // Add to sync queue
  private queueSync(name: string) {
    // Don't queue duplicates
    if (this.syncQueue.some(item => item.name === name)) return;
    
    // Limit queue size
    if (this.syncQueue.length >= this.MAX_QUEUE_SIZE) {
      this.logger.warn('syncQueue:full', {
        dropped: name,
        queueSize: this.syncQueue.length
      });
      return;
    }
    
    this.syncQueue.push({
      name,
      timestamp: Date.now()
    });
    
    this.logger.info('syncQueue:added', {
      name,
      queueLength: this.syncQueue.length
    });
    
    // Start processing if not already running
    if (!this.processingQueue) {
      this.processSyncQueue();
    }
  }

  // Queue multiple syncs with staggered delay
  private queueSyncsWithDelay(names: string[]) {
    names.forEach((name, index) => {
      setTimeout(() => this.queueSync(name), index * this.SYNC_DELAY);
    });
  }

  // Main sync methods
  async syncAll(): Promise<void> {
    return withErrorHandling(async () => {
      const settings = await this.storage.getSettings();
      if (!settings.containerFolderId) return;

      // Start with tab groups
      const mappings = await this.storage.getAllMappings();
      const enabledGroups = Object.entries(mappings)
        .filter(async ([name]) => {
          const groupSettings = await this.storage.getGroupSyncSettings(name);
          return groupSettings.enabled;
        })
        .map(([name]) => name);

      // Queue syncs with delay
      this.queueSyncsWithDelay(enabledGroups);

    }, ErrorType.SYNC);
  }

  async ensureSyncFolders(name: string): Promise<BookmarkFolderId> {
    // Get container folder, recreate if missing
    const settings = await this.storage.getSettings();
    if (!settings.containerFolderId) {
      throw new SyncError('Please select a location for your bookmarks first');
    }

    let containerFolder = await this.bookmarkManager.getContainerFolder();
    if (!containerFolder) {
      // Container folder was deleted, create new one at same location
      containerFolder = await this.bookmarkManager.createContainerFolder();
      await this.storage.updateSettings({ 
        containerFolderId: containerFolder.id 
      });
    }

    // Get or create group folder
    const folder = await this.bookmarkManager.ensureGroupFolder(name);
    return folder.id;
  }

  private async computeTabsHash(tabs: chrome.tabs.Tab[]): Promise<string> {
    const tabData = tabs.map(tab => ({
      url: tab.url,
      title: tab.title,
      pinned: tab.pinned
    }));
    const hash = await crypto.subtle.digest('SHA-256', 
      new TextEncoder().encode(JSON.stringify(tabData))
    );
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async syncGroupToFolder(name: string): Promise<void> {
    const opId = this.tracker.startOperation('syncGroupToFolder', { name });
    
    return withErrorHandling(async () => {
      // Get current sync state
      const mapping = await this.storage.getMapping(name);
      if (!mapping || !mapping.syncEnabled) {
        // Add history entry for disabled sync
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'group-to-folder',
          groupId: `group:${name}`,
          success: false,
          error: 'Sync is disabled'
        });
        return;
      }

      // Get current tabs
      this.logger.debug('sync:starting', {
        name,
        mapping,
        enabled: mapping?.syncEnabled,
        lastSynced: mapping?.status.lastSynced
      });

      // Get current group
      let group = null;
      if (mapping.currentGroupId) {
        group = await this.tabGroupManager.getGroup(parseInt(mapping.currentGroupId));
        this.logger.debug('sync:groupLookup', {
          name,
          groupId: mapping.currentGroupId,
          found: !!group,
          windowId: group?.windowId
        });
      }

      // If group not found but we have an ID, show error
      if (mapping.currentGroupId && !group) {
        // Try to find any group with this name
        const allGroups = await chrome.tabGroups.query({});
        const sameNameGroup = allGroups.find(g => (g.title || 'Unnamed Group') === name);
        
        this.logger.debug('sync:groupSearch', {
          name,
          currentId: mapping.currentGroupId,
          allGroups: allGroups.map(g => ({ 
            id: g.id, 
            title: g.title,
            windowId: g.windowId 
          })),
          foundMatchingName: !!sameNameGroup
        });

        // If found group with same name but different ID
        if (sameNameGroup && sameNameGroup.id.toString() !== mapping.currentGroupId) {
          this.logger.info('sync:groupIdChanged', {
            name,
            oldId: mapping.currentGroupId,
            newId: sameNameGroup.id,
            windowId: sameNameGroup.windowId
          });

          // Update mapping with new ID
          await this.storage.updateMapping(name, {
            currentGroupId: sameNameGroup.id.toString(),
            status: {
              lastSynced: mapping.status.lastSynced,
              inProgress: false,
              error: undefined
            }
          });

          // Retry sync with new ID
          group = sameNameGroup;
        } else {
          this.logger.warn('sync:groupNotFound', {
            name,
            groupId: mapping.currentGroupId,
            searchResult: 'No matching groups found'
          });

          // Keep sync enabled but show error
          await this.storage.updateMapping(name, {
            status: {
              lastSynced: mapping.status.lastSynced,
              inProgress: false,
              error: 'Group not found - Will retry when available'
            }
          });

          // Add history entry
          await this.storage.addHistoryEntry({
            timestamp: Date.now(),
            type: 'group-to-folder',
            groupId: `group:${name}`,
            folderId: mapping.folderId,
            success: false,
            error: 'Group not found'
          });
          return;
        }
      }

      // Get tabs from group
      let tabs: chrome.tabs.Tab[] = [];
      if (group) {
        try {
          tabs = await withRetry<chrome.tabs.Tab[]>('getGroupTabs',
            () => getTabsInGroup(group.id),
            { maxAttempts: 3, delayMs: 500 }
          );
          this.logger.debug('sync:getTabs', {
            name,
            groupId: group.id,
            tabCount: tabs.length,
            tabs: tabs.map(t => ({ 
              id: t.id, 
              url: t.url,
              title: t.title 
            }))
          });
        } catch (error) {
          this.logger.error('sync:getTabsFailed', {
            name,
            groupId: group.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          throw error;
        }
      }

      // Check if tabs have changed
      const currentHash = await this.computeTabsHash(tabs);
      const lastHash = this.lastKnownHashes.get(name);
      if (currentHash === lastHash) {
        this.logger.debug('sync:skipped', {
          name,
          reason: 'no changes'
        });
        
        // Add history entry for unchanged sync
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'group-to-folder',
          groupId: `group:${name}`,
          folderId: mapping.folderId,
          success: true,
          details: 'No changes detected'
        });

        // Update last synced time
        await this.storage.updateMapping(name, {
          status: { 
            lastSynced: Date.now(),
            inProgress: false,
            error: undefined
          }
        });
        return;
      }
      this.lastKnownHashes.set(name, currentHash);

      // Update sync status
      await this.storage.updateMapping(name, {
        status: { lastSynced: Date.now(), inProgress: true }
      });

      try {
        // Try to sync to existing folder first
        try {
          if (mapping.folderId) {
            await withRetry('syncToFolder',
              () => this.bookmarkManager.syncGroupToFolder(name, tabs, mapping.folderId),
              { maxAttempts: 3, delayMs: 1000 }
            );
            
            // Add success entry to history
            await this.storage.addHistoryEntry({
              timestamp: Date.now(),
              type: 'group-to-folder',
              groupId: `group:${name}`,
              folderId: mapping.folderId,
              success: true,
              details: `${tabs.length} tabs synced`
            });
            return;
          }
        } catch (error) {
          this.logger.warn('sync:existingFolderFailed', {
            name,
            folderId: mapping.folderId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          // Continue to recreate folder
        }

        // If existing folder sync failed or no folder exists, create new one
        const folder = await this.bookmarkManager.ensureGroupFolder(name);
        
        // Update mapping with new folder
        await this.storage.updateMapping(name, { 
          folderId: folder.id,
          status: {
            lastSynced: Date.now(),
            inProgress: true
          }
        });

        // Sync tabs to new folder
        await withRetry('syncToFolder',
          () => this.bookmarkManager.syncGroupToFolder(name, tabs, folder.id),
          { maxAttempts: 3, delayMs: 1000 }
        );

        // Update sync status on success
        await this.storage.updateMapping(name, {
          status: { 
            lastSynced: Date.now(), 
            inProgress: false,
            error: undefined // Clear any previous error
          }
        });

        // Add success entry to history
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'group-to-folder',
          groupId: `group:${name}`,
          folderId: folder.id,
          success: true,
          details: `${tabs.length} tabs synced to new folder`
        });

        this.logger.info('sync:completed', {
          name,
          tabCount: tabs.length
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('sync:failed', {
          name,
          error: errorMessage
        }, error instanceof Error ? error : undefined);

        // Update sync status on failure
        await this.storage.updateMapping(name, {
          status: {
            lastSynced: Date.now(),
            inProgress: false,
            error: errorMessage
          }
        });

        // Add failure entry to history
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'group-to-folder',
          groupId: `group:${name}`,
          folderId: mapping.folderId,
          success: false,
          error: errorMessage
        });

        throw error;
      } finally {
        this.tracker.endOperation(opId);
      }
    }, ErrorType.SYNC);
  }

  // Public methods for tab group sync management
  async getGroupSyncEnabled(name: string): Promise<boolean> {
    const settings = await this.storage.getGroupSyncSettings(name);
    return settings.enabled;
  }

  async setGroupSyncEnabled(name: string, enabled: boolean): Promise<void> {
    const settings = await this.storage.getSettings();
    if (!settings.containerFolderId) {
      throw new SyncError('Please select a location for your bookmarks first');
    }

    try {
      const timestamp = Date.now();
      
      // First update the persisted preference
      await this.storage.updateGroupSyncSettings(name, { 
        enabled,
        lastSynced: timestamp
      });

      // Then get or create folder if enabling sync
      let folderId = '';
      if (enabled) {
        const folder = await this.bookmarkManager.ensureGroupFolder(name);
        folderId = folder.id;
      } else {
        const mapping = await this.storage.getMapping(name);
        folderId = mapping?.folderId || '';
      }
      
      // Update runtime mapping
      await this.storage.updateMapping(name, { 
        name,
        folderId,
        syncEnabled: enabled,
        status: {
          lastSynced: timestamp,
          inProgress: false,
          error: undefined
        }
      });
      
      // Add history entry
      await this.storage.addHistoryEntry({
        timestamp,
        type: 'group-to-folder',
        groupId: `group:${name}`,
        folderId,
        success: true,
        details: enabled ? 'Sync enabled' : 'Sync disabled'
      });

      if (enabled) {
        // Find current group with this name
        const allGroups = await chrome.tabGroups.query({});
        const group = allGroups.find(g => (g.title || 'Unnamed Group') === name);
        
        if (group) {
          // Get current tabs
          const tabs = await getTabsInGroup(group.id);
          
          // Queue sync instead of immediate sync
          this.queueSync(name);
        }

        this.logger.info('sync:enabled', { name });
      } else {
        this.logger.info('sync:disabled', { name });
      }
    } catch (error) {
      this.logger.error('setGroupSyncEnabled:failed', {
        name,
        enabled,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async toggleSync(name: string): Promise<void> {
    return withErrorHandling(async () => {
      const settings = await this.storage.getSettings();
      if (!settings.containerFolderId) {
        throw new SyncError('Please select a location for your bookmarks first');
      }

      // Get current sync state
      const mapping = await this.storage.getMapping(name);
      const currentState = mapping?.syncEnabled ?? false;
      const newSyncEnabled = !currentState;

      // Use setGroupSyncEnabled to handle all the sync logic
      await this.setGroupSyncEnabled(name, newSyncEnabled);
    }, ErrorType.SYNC);
  }

  // Group event handlers
  async handleGroupCreated(group: chrome.tabGroups.TabGroup): Promise<void> {
    const settings = await this.storage.getSettings();
    const name = group.title || 'Unnamed Group';

    // Check if this group should be synced (either autoSync or previously enabled)
    const groupSettings = await this.storage.getGroupSyncSettings(name);
    if ((settings.autoSync && settings.containerFolderId) || groupSettings.enabled) {
      // Ensure folder exists
      const folder = await this.bookmarkManager.ensureGroupFolder(name);
      
      // Get current mapping if it exists
      const mapping = await this.storage.getMapping(name);
      
      // Create or update mapping
      await this.storage.updateMapping(name, {
        name,
        currentGroupId: group.id.toString(),
        color: group.color,
        folderId: folder.id,
        // Keep existing sync state if available, otherwise enable
        syncEnabled: mapping?.syncEnabled ?? true,
        status: {
          // Keep existing lastSynced if available
          lastSynced: mapping?.status.lastSynced ?? Date.now(),
          inProgress: false,
          error: undefined // Clear any previous errors
        }
      });

      // Enable sync settings if auto-sync and not already enabled
      if (settings.autoSync && !groupSettings.enabled) {
        await this.storage.updateGroupSyncSettings(name, { 
          enabled: true,
          lastSynced: Date.now()
        });
      }

      // Queue sync if enabled
      if (groupSettings.enabled) {
        this.queueSync(name);
      }
      
      this.logger.info('sync:groupCreated', { 
        name,
        autoSync: settings.autoSync,
        previouslyEnabled: groupSettings.enabled,
        syncEnabled: groupSettings.enabled
      });
    }
  }

  async handleGroupUpdated(group: chrome.tabGroups.TabGroup): Promise<void> {
    const name = group.title || 'Unnamed Group';
    const groupSettings = await this.storage.getGroupSyncSettings(name);
    
    // Only check groupSettings.enabled since it's the source of truth
    if (groupSettings.enabled) {
      let mapping = await this.storage.getMapping(name);
      
      // If mapping doesn't exist or sync is disabled but should be enabled
      if (!mapping || !mapping.syncEnabled) {
        // Create/update mapping with sync enabled
        await this.storage.updateMapping(name, {
          name,
          currentGroupId: group.id.toString(),
          color: group.color,
          syncEnabled: true,
          status: {
            lastSynced: Date.now(),
            inProgress: false
          }
        });
        mapping = await this.storage.getMapping(name);
      } else {
        // Update existing mapping
        await this.storage.updateMapping(name, {
          currentGroupId: group.id.toString(),
          color: group.color
        });
      }

      // Ensure folder exists and queue sync
      if (mapping) {
        const folder = await this.bookmarkManager.ensureGroupFolder(name);
        this.queueSync(name);
      }
    }
  }

  async handleGroupRemoved(name: string): Promise<void> {
    // Update mapping to remove current group ID but keep the folder
    await this.storage.updateMapping(name, {
      currentGroupId: undefined
    });

    // Add history entry for group removal
    await this.storage.addHistoryEntry({
      timestamp: Date.now(),
      type: 'group-to-folder',
      groupId: `group:${name}`,
      success: true,
      details: 'Group removed, bookmarks preserved'
    });

    this.logger.info('sync:groupRemoved', {
      name,
      action: 'bookmarks preserved'
    });
  }

  async fullResyncGroup(group: chrome.tabGroups.TabGroup): Promise<void> {
    const opId = this.tracker.startOperation('fullResyncGroup', { 
      groupId: group.id,
      title: group.title 
    });

    return withErrorHandling(async () => {
      try {
        const name = group.title || 'Unnamed Group';
        
        // Get current tabs
        const tabs = await withRetry<chrome.tabs.Tab[]>('getGroupTabs',
          () => getTabsInGroup(group.id),
          { maxAttempts: 3, delayMs: 500 }
        );

        // Get or create mapping
        let mapping = await this.storage.getMapping(name);
        if (!mapping) {
          // Create new mapping
          await this.storage.updateMapping(name, {
            name,
            currentGroupId: group.id.toString(),
            color: group.color,
            syncEnabled: true,
            status: {
              lastSynced: 0,
              inProgress: false
            }
          });
          mapping = await this.storage.getMapping(name);
          if (!mapping) {
            throw new SyncError('Failed to create mapping');
          }
        }

        // Queue full resync
        this.queueSync(name);

        this.logger.info('fullResyncGroup:queued', { 
          name,
          tabCount: tabs.length
        });
      } catch (error) {
        this.logger.error('fullResyncGroup:failed', {
          groupId: group.id,
          title: group.title,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, error instanceof Error ? error : undefined);
        throw error;
      } finally {
        this.tracker.endOperation(opId);
      }
    }, ErrorType.SYNC);
  }
}
