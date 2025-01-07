import { StorageManager } from '../storage/storageManager';
import { BookmarkManager } from '../bookmarks/bookmarkManager';
import { TabGroupManager } from '../tabGroupManager';
import { getTabsInGroup } from '../utils/tabUtils';
import { SyncError, ErrorType, withErrorHandling } from '../utils/errors';
import { Logger, withRetry, OperationTracker } from '../utils/logger';
import { BookmarkFolderId, RuntimeMapping, RuntimeMappingUpdate } from '../types/storage';

export class SyncEngine {
  private logger = Logger.getInstance();
  private tracker = OperationTracker.getInstance();

  constructor(
    private storage: StorageManager,
    private bookmarkManager: BookmarkManager,
    private tabGroupManager: TabGroupManager
  ) {
    this.logger.info('SyncEngine:init', { timestamp: Date.now() });
  }

  // Main sync methods
  async syncAll(): Promise<void> {
    return withErrorHandling(async () => {
      const settings = await this.storage.getSettings();
      if (!settings.containerFolderId) return;

      // Start with tab groups
      const mappings = await this.storage.getAllMappings();
      for (const [name, mapping] of Object.entries(mappings)) {
        const groupSettings = await this.storage.getGroupSyncSettings(name);
        if (groupSettings.enabled) {
          await this.syncGroupToFolder(name);
        }
      }

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

  async syncGroupToFolder(name: string): Promise<void> {
    const opId = this.tracker.startOperation('syncGroupToFolder', { name });
    
    return withErrorHandling(async () => {
      // Get current sync state
      const mapping = await this.storage.getMapping(name);
      if (!mapping || !mapping.syncEnabled) return;

      // Update sync status
      await this.storage.updateMapping(name, {
        status: { lastSynced: Date.now(), inProgress: true }
      });

      try {
        // Get current group info if it exists
        const group = mapping.currentGroupId ? 
          await this.tabGroupManager.getGroup(parseInt(mapping.currentGroupId)) : null;

        // Get current tabs if group exists
        const tabs = group ? 
          await withRetry<chrome.tabs.Tab[]>('getGroupTabs',
            () => getTabsInGroup(group.id),
            { maxAttempts: 3, delayMs: 500 }
          ) : [];

        // Try to sync to existing folder first
        try {
          if (mapping.folderId) {
            await withRetry('syncToFolder',
              () => this.bookmarkManager.syncGroupToFolder(name, tabs, mapping.folderId),
              { maxAttempts: 3, delayMs: 1000 }
            );
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
          folderId: mapping.folderId,
          success: true
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

    // Get or create folder if enabling sync
    let folderId = '';
    if (enabled) {
      const folder = await this.bookmarkManager.ensureGroupFolder(name);
      folderId = folder.id;
    } else {
      const mapping = await this.storage.getMapping(name);
      folderId = mapping?.folderId || '';
    }

    try {
      const timestamp = Date.now();
      
      // Batch all storage operations into a single update
      await Promise.all([
        // Update sync settings
        this.storage.updateGroupSyncSettings(name, { 
          enabled,
          lastSynced: timestamp
        }),
        
        // Update mapping
        this.storage.updateMapping(name, { 
          name,
          folderId,
          syncEnabled: enabled,
          status: {
            lastSynced: timestamp,
            inProgress: false,
            error: undefined // Clear any previous errors
          }
        }),
        
        // Add history entry
        this.storage.addHistoryEntry({
          timestamp,
          type: 'group-to-folder',
          folderId,
          success: true
        })
      ]);
    } catch (error) {
      this.logger.error('setGroupSyncEnabled:failed', {
        name,
        enabled,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }

    if (enabled) {
      // Find current group with this name
      const allGroups = await chrome.tabGroups.query({});
      const group = allGroups.find(g => (g.title || 'Unnamed Group') === name);
      
      if (group) {
        // Get current tabs
        const tabs = await getTabsInGroup(group.id);
        
        // Sync tabs to folder
        await this.bookmarkManager.syncGroupToFolder(name, tabs, folderId);
      }

      this.logger.info('sync:enabled', { name });
    } else {
      this.logger.info('sync:disabled', { name });
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

    // If autoSync is enabled, enable sync for this group
    if (settings.autoSync && settings.containerFolderId) {
      // Create or update mapping
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

      // Enable sync and perform initial sync
      await this.storage.updateGroupSyncSettings(name, { enabled: true });
      await this.syncGroupToFolder(name);
    }
  }

  async handleGroupUpdated(group: chrome.tabGroups.TabGroup): Promise<void> {
    const name = group.title || 'Unnamed Group';
    const mapping = await this.storage.getMapping(name);
    const groupSettings = await this.storage.getGroupSyncSettings(name);

    if (mapping?.syncEnabled && groupSettings.enabled) {
      // Update mapping with current group ID and color
      await this.storage.updateMapping(name, {
        currentGroupId: group.id.toString(),
        color: group.color
      });

      await this.syncGroupToFolder(name);
    }
  }

  async handleGroupRemoved(name: string): Promise<void> {
    // Update mapping to remove current group ID but keep the folder
    await this.storage.updateMapping(name, {
      currentGroupId: undefined
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

        // Full resync with current tabs
        await withRetry('fullResync',
          () => this.bookmarkManager.syncGroupToFolder(name, tabs, mapping!.folderId),
          { maxAttempts: 3, delayMs: 1000 }
        );

        this.logger.info('fullResyncGroup:success', { 
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
