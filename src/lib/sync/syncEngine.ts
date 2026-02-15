import { StorageManager } from '../storage/storageManager';
import { BookmarkManager } from '../bookmarks/bookmarkManager';
import { TabGroupManager } from '../tabGroupManager';
import { getTabsInGroup } from '../utils/tabUtils';
import { SyncError, ErrorType, withErrorHandling } from '../utils/errors';
import { Logger, OperationTracker, withRetry } from '../utils/logger';
import { BookmarkFolderId, RuntimeMapping, RuntimeMappingUpdate } from '../types/storage';
import { resolveGroupName } from '../utils/groupNameResolver';

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
  private groupOpLocks: Map<string, Promise<void>> = new Map();

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

      // Discover unmapped groups when autoSync is enabled
      if (settings.autoSync) {
        const allGroups = await chrome.tabGroups.query({});
        for (const group of allGroups) {
          const name = resolveGroupName(group.title);
          if (name === null) continue;

          const mapping = await this.storage.getMapping(name);
          if (!mapping) {
            this.logger.info('sync:discover', { name, reason: 'unmapped group found during syncAll' });
            await this.handleGroupCreated(group);
          }
        }
      }

      // Sync all mapped & enabled groups
      const mappings = await this.storage.getAllMappings();
      const enabledGroups: string[] = [];
      for (const [name] of Object.entries(mappings)) {
        const groupSettings = await this.storage.getGroupSyncSettings(name);
        if (groupSettings.enabled) {
          enabledGroups.push(name);
        }
      }

      // Queue syncs with delay
      this.queueSyncsWithDelay(enabledGroups);

    }, ErrorType.SYNC);
  }

  async ensureSyncFolders(name: string): Promise<BookmarkFolderId | null> {
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
    
    // If group name is whitespace-only, return null
    if (folder === null) {
      return null;
    }
    
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
      // Get current sync state from persisted settings
      const groupSettings = await this.storage.getGroupSyncSettings(name);
      const mapping = await this.storage.getMapping(name);
      
      if (!groupSettings.enabled) {
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
        enabled: groupSettings.enabled,
        lastSynced: mapping?.status.lastSynced
      });

      // Get current group
      let group = null;
      if (mapping?.currentGroupId) {
        group = await this.tabGroupManager.getGroup(parseInt(mapping.currentGroupId));
        this.logger.debug('sync:groupLookup', {
          name,
          found: !!group,
          window: group ? `Window ${group.windowId}` : 'Not found'
        });
      }

      // If group not found but we have an ID, show error
      if (mapping?.currentGroupId && !group) {
        // Try to find any group with this name
        const allGroups = await chrome.tabGroups.query({});
        const sameNameGroup = allGroups.find(g => resolveGroupName(g.title) === name);
        
        this.logger.debug('sync:groupSearch', {
          name,
          currentId: mapping.currentGroupId,
          groupsFound: allGroups.map(g => ({ 
            name: resolveGroupName(g.title),
            window: `Window ${g.windowId}`,
            color: g.color
          })),
          foundMatchingName: !!sameNameGroup
        });

        // If found group with same name but different ID
        if (sameNameGroup && sameNameGroup.id.toString() !== mapping.currentGroupId) {
          this.logger.info('sync:groupFound', {
            name,
            window: `Window ${sameNameGroup.windowId}`,
            color: sameNameGroup.color
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
            window: `Window ${group.windowId}`,
            tabCount: tabs.length,
            tabs: tabs.map(t => ({ 
              title: t.title,
              url: t.url?.substring(0, 50) + '...',
              pinned: t.pinned
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
        
        // Record in-memory history (visible in popup) but don't write to chrome.storage.sync
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'group-to-folder',
          groupId: `group:${name}`,
          folderId: mapping?.folderId,
          success: true,
          details: 'Synced, no changes'
        }, { persistToStorage: false });
        return;
      }
      this.lastKnownHashes.set(name, currentHash);

      try {
        // Only update runtime status, no storage write needed
        if (mapping) {
          mapping.status.inProgress = true;
          mapping.status.error = undefined;
        }

        // Ensure we have a valid folder (creates or finds existing by name)
        const folder = await this.bookmarkManager.ensureGroupFolder(name);

        // Update mapping if folder ID changed (e.g., folder was deleted and recreated)
        if (!mapping?.folderId || mapping.folderId !== folder.id) {
          await this.storage.updateMapping(name, { 
            folderId: folder.id
          });
        }

        // Sync tabs to the resolved folder
        await withRetry('syncToFolder',
          () => this.bookmarkManager.syncGroupToFolder(name, tabs, folder.id),
          { maxAttempts: 3, delayMs: 1000 }
        );

        // Add success entry to history
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'group-to-folder',
          groupId: `group:${name}`,
          folderId: folder.id,
          success: true,
          details: `${tabs.length} tabs synced`
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

        // Only update runtime status, no storage write needed
        if (mapping) {
          mapping.status.inProgress = false;
          mapping.status.error = errorMessage;
        }

        // Log failure
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'group-to-folder',
          groupId: `group:${name}`,
          folderId: mapping?.folderId,
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
      
      // First update the persisted settings (source of truth)
      await this.storage.updateGroupSyncSettings(name, { 
        enabled,
        lastSynced: timestamp
      });
      
      // Get or create folder if enabling sync
      let folderId = '';
      if (enabled) {
        const folder = await this.bookmarkManager.ensureGroupFolder(name);
        if (!folder) {
          throw new SyncError(`Cannot enable sync for group "${name}": invalid group name`);
        }
        folderId = folder.id;
      } else {
        const mapping = await this.storage.getMapping(name);
        folderId = mapping?.folderId || '';
      }
      
      // Find current group with this name (needed for currentGroupId and to queue sync)
      const allGroups = await chrome.tabGroups.query({});
      const group = allGroups.find(g => resolveGroupName(g.title) === name);

      // Update runtime mapping to match persisted state
      await this.storage.updateMapping(name, { 
        name,
        folderId,
        syncEnabled: enabled,
        userAction: true, // Mark as user-initiated change
        ...(group ? { currentGroupId: group.id.toString(), color: group.color } : {})
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

      if (enabled && group) {
        // Queue sync instead of immediate sync
        this.queueSync(name);

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

      // Get current sync state from persisted settings (source of truth)
      const groupSettings = await this.storage.getGroupSyncSettings(name);
      const newSyncEnabled = !groupSettings.enabled;

      // Use setGroupSyncEnabled to handle all the sync logic
      await this.setGroupSyncEnabled(name, newSyncEnabled);
    }, ErrorType.SYNC);
  }

  // Group event handlers
  async handleGroupCreated(group: chrome.tabGroups.TabGroup): Promise<void> {
    const settings = await this.storage.getSettings();
    
    // Resolve group name - skip if unnamed or whitespace-only
    const name = resolveGroupName(group.title);
    if (name === null) {
      this.logger.info('sync:groupCreatedSkipped', {
        groupTitle: group.title,
        reason: 'unnamed or whitespace-only name'
      });
      return;
    }

    // Serialize concurrent operations for the same group name
    const existingLock = this.groupOpLocks.get(name);
    if (existingLock) {
      await existingLock;
    }
    const opPromise = this._handleGroupCreatedImpl(group, name, settings);
    this.groupOpLocks.set(name, opPromise.catch(() => {}));
    try {
      await opPromise;
    } finally {
      this.groupOpLocks.delete(name);
    }
  }

  private async _handleGroupCreatedImpl(
    group: chrome.tabGroups.TabGroup,
    name: string,
    settings: any
  ): Promise<void> {
    // Check if this group should be synced (either autoSync or previously enabled)
    const groupSettings = await this.storage.getGroupSyncSettings(name);
    if ((settings.autoSync && settings.containerFolderId) || groupSettings.enabled) {
      // Ensure folder exists
      const folder = await this.bookmarkManager.ensureGroupFolder(name);
      
      // If folder is null (whitespace-only), skip
      if (folder === null) {
        this.logger.info('sync:groupCreatedSkipped', {
          name,
          reason: 'whitespace-only name'
        });
        return;
      }
      
      // Get current mapping if it exists
      const mapping = await this.storage.getMapping(name);
      
      // Determine if sync should be enabled
      let syncEnabled = groupSettings.enabled;
      
      // Only update settings if auto-sync is enabled and not already enabled
      if (settings.autoSync && !groupSettings.enabled) {
        this.logger.info('sync:autoSync', {
          name,
          action: 'enabling',
          reason: 'autoSync enabled'
        });
        await this.storage.updateGroupSyncSettings(name, { 
          enabled: true,
          lastSynced: Date.now()
        });
        syncEnabled = true; // Update local variable to reflect the change
      }

      // Create or update mapping to match persisted settings
      await this.storage.updateMapping(name, {
        name,
        currentGroupId: group.id.toString(),
        color: group.color,
        folderId: folder.id,
        syncEnabled, // Use the updated value
        status: {
          lastSynced: mapping?.status.lastSynced ?? Date.now(),
          inProgress: false,
          error: undefined
        }
      });

      // Queue sync if enabled
      if (syncEnabled) {
        this.queueSync(name);
      }
      
      this.logger.info('sync:groupCreated', { 
        name,
        autoSync: settings.autoSync,
        previouslyEnabled: groupSettings.enabled,
        syncEnabled
      });
    }
  }

  async handleGroupUpdated(group: chrome.tabGroups.TabGroup): Promise<void> {
    // Resolve group name - skip if unnamed or whitespace-only
    const name = resolveGroupName(group.title);
    if (name === null) {
      this.logger.info('sync:groupUpdatedSkipped', {
        groupTitle: group.title,
        reason: 'unnamed or whitespace-only name'
      });
      return;
    }

    // Serialize concurrent operations for the same group name
    const existingLock = this.groupOpLocks.get(name);
    if (existingLock) {
      await existingLock;
    }
    const opPromise = this._handleGroupUpdatedImpl(group, name);
    this.groupOpLocks.set(name, opPromise.catch(() => {}));
    try {
      await opPromise;
    } finally {
      this.groupOpLocks.delete(name);
    }
  }

  private async _handleGroupUpdatedImpl(
    group: chrome.tabGroups.TabGroup,
    name: string
  ): Promise<void> {
    const groupSettings = await this.storage.getGroupSyncSettings(name);
    let mapping = await this.storage.getMapping(name);
    
    // Log current state
    this.logger.info('sync:stateCheck', {
      name,
      event: 'groupUpdated',
      hasMapping: !!mapping,
      mappingEnabled: mapping?.syncEnabled,
      settingsEnabled: groupSettings.enabled
    });

    // If no mapping exists, this might be a group that was created without a title
    // and now has a valid title, or a renamed group - treat it as a new group
    // (per Req 1.4: title changes create a new folder, old folder preserved)
    if (!mapping) {
      this.logger.info('sync:groupUpdatedAsNew', {
        name,
        reason: 'no existing mapping - treating as new group'
      });
      await this._handleGroupCreatedImpl(group, name, await this.storage.getSettings());
      return;
    }

    // Always update mapping to match persisted settings
    await this.storage.updateMapping(name, {
      currentGroupId: group.id.toString(),
      color: group.color,
      // Always use the persisted settings as source of truth
      syncEnabled: groupSettings.enabled
    });

    // Only queue sync if enabled in persisted settings
    // Folder creation is deferred to syncGroupToFolder to avoid duplicate folders
    if (groupSettings.enabled) {
      this.queueSync(name);
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
        
        // Resolve group name - skip if unnamed or whitespace-only
        const name = resolveGroupName(group.title);
        if (name === null) {
          this.logger.info('fullResyncGroup:skipped', {
            groupTitle: group.title,
            reason: 'unnamed or whitespace-only name'
          });
          return;
        }
        
        // Get current tabs
        const tabs = await withRetry<chrome.tabs.Tab[]>('getGroupTabs',
          () => getTabsInGroup(group.id),
          { maxAttempts: 3, delayMs: 500 }
        );

        // Get persisted settings first
        const groupSettings = await this.storage.getGroupSyncSettings(name);
        const settings = await this.storage.getSettings();
        
        // Get or create mapping
        let mapping = await this.storage.getMapping(name);
        if (!mapping) {
          // Determine if sync should be enabled
          let syncEnabled = groupSettings.enabled;
          
          // If auto-sync is enabled and group sync is not already enabled, enable it
          if (settings.autoSync && settings.containerFolderId && !groupSettings.enabled) {
            this.logger.info('fullResyncGroup:autoSync', {
              name,
              action: 'enabling',
              reason: 'autoSync enabled'
            });
            await this.storage.updateGroupSyncSettings(name, { 
              enabled: true,
              lastSynced: Date.now()
            });
            syncEnabled = true;
          }
          
          // Get or create folder first
          const folder = await this.bookmarkManager.ensureGroupFolder(name);
          if (!folder) {
            throw new SyncError(`Cannot sync group "${name}": invalid group name`);
          }
          
          // Create new mapping with correct folder ID
          await this.storage.updateMapping(name, {
            name,
            currentGroupId: group.id.toString(),
            color: group.color,
            folderId: folder.id,
            syncEnabled,
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

        // Queue full resync if enabled in persisted settings
        if (groupSettings.enabled || (settings.autoSync && settings.containerFolderId)) {
          this.queueSync(name);
        }

        this.logger.info('fullResyncGroup:queued', { 
          name,
          tabCount: tabs.length,
          syncEnabled: groupSettings.enabled || (settings.autoSync && settings.containerFolderId)
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
