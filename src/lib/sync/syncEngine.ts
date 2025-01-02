import { StorageManager } from '../storage/storageManager';
import { BookmarkManager } from '../bookmarkManager';
import { TabGroupManager } from '../tabGroupManager';
import { getTabsInGroup } from '../utils/tabUtils';
import { SyncError, ErrorType, withErrorHandling } from '../utils/errors';
import { Logger, LogLevel, withRetry, OperationTracker } from '../utils/logger';
import { GroupFolderMapping, TabGroupId, BookmarkFolderId } from '../types/storage';

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

  private toNumberId(id: TabGroupId): number {
    return parseInt(id, 10);
  }

  // Main sync methods
  async syncAll(): Promise<void> {
    return withErrorHandling(async () => {
      const settings = await this.storage.getSettings();
      if (!settings.autoSync) return;

      // Start with tab groups
      const mappings = await this.storage.getAllMappings();
      for (const mapping of Object.values(mappings)) {
        if (mapping.syncEnabled) {
          await this.syncGroupToFolder(mapping.groupId);
        }
      }

      // Handle ungrouped tabs if enabled
      const ungroupedSettings = await this.storage.getUngroupedSettings();
      if (ungroupedSettings.enabled && ungroupedSettings.syncEnabled) {
        await this.syncUngroupedTabs();
      }
    }, ErrorType.SYNC);
  }

  async syncGroupToFolder(groupId: TabGroupId): Promise<void> {
    const opId = this.tracker.startOperation('syncGroupToFolder', { groupId });
    
    return withErrorHandling(async () => {
      const mapping = await this.storage.getMapping(groupId);
      if (!mapping || !mapping.syncEnabled) return;

      const numericId = this.toNumberId(groupId);

      // Update sync status
      await this.storage.updateMapping(groupId, {
        status: { lastSynced: Date.now(), inProgress: true }
      });

      try {
        const group = await withRetry('getGroup', 
          () => this.tabGroupManager.getGroup(numericId),
          { maxAttempts: 3, delayMs: 500 }
        );
        
        if (!group) {
          throw new SyncError(`Tab group ${groupId} not found`);
        }

        const tabs = await withRetry<chrome.tabs.Tab[]>('getGroupTabs',
          () => getTabsInGroup(numericId),
          { maxAttempts: 3, delayMs: 500 }
        );

        await withRetry('syncToFolder',
          () => this.bookmarkManager.syncGroupToFolder(groupId, tabs, group.title || 'Unnamed Group'),
          { maxAttempts: 3, delayMs: 1000 }
        );

        // Update sync status on success
        await this.storage.updateMapping(groupId, {
          status: { lastSynced: Date.now(), inProgress: false }
        });

        // Add success entry to history
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'group-to-folder',
          groupId,
          folderId: mapping.folderId,
          success: true
        });
      } catch (error) {
        this.logger.error('syncGroupToFolder:failed', {
          groupId,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, error instanceof Error ? error : undefined);
        // Update sync status on failure
        await this.storage.updateMapping(groupId, {
          status: {
            lastSynced: Date.now(),
            inProgress: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        });

        // Add failure entry to history
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'group-to-folder',
          groupId,
          folderId: mapping.folderId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        throw error;
      } finally {
        this.tracker.endOperation(opId);
      }
    }, ErrorType.SYNC);
  }


  async syncUngroupedTabs(): Promise<void> {
    return withErrorHandling(async () => {
      const settings = await this.storage.getUngroupedSettings();
      if (!settings.enabled || !settings.syncEnabled) return;

      // Update sync status
      await this.storage.updateUngroupedSettings({
        status: { lastSynced: Date.now(), inProgress: true }
      });

      try {
        const ungroupedTabs = await this.tabGroupManager.getUngroupedTabs();
        if (!settings.folderId) {
          const folder = await this.bookmarkManager.createUngroupedFolder();
          await this.storage.updateUngroupedSettings({ folderId: folder.id });
        }

        await this.bookmarkManager.syncUngroupedTabs(ungroupedTabs);

        // Update sync status on success
        await this.storage.updateUngroupedSettings({
          status: { lastSynced: Date.now(), inProgress: false }
        });

        // Add success entry to history
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'ungrouped',
          folderId: settings.folderId!,
          success: true
        });
      } catch (error) {
        // Update sync status on failure
        await this.storage.updateUngroupedSettings({
          status: {
            lastSynced: Date.now(),
            inProgress: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        });

        // Add failure entry to history
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'ungrouped',
          folderId: settings.folderId!,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        throw error;
      }
    }, ErrorType.SYNC);
  }

  // Mapping management
  async createMapping(
    groupId: TabGroupId,
    folderId: BookmarkFolderId,
    name: string,
    color?: string
  ): Promise<void> {
    return withErrorHandling(async () => {
      const mapping: GroupFolderMapping = {
        groupId,
        folderId,
        name,
        color,
        syncEnabled: true,
        status: {
          lastSynced: 0,
          inProgress: false
        }
      };

      await this.storage.addMapping(mapping);
      await this.syncGroupToFolder(groupId);
    }, ErrorType.SYNC);
  }

  // Public methods for tab group sync management
  async getGroupSyncEnabled(groupId: TabGroupId): Promise<boolean> {
    return this.tabGroupManager.getSyncEnabled(this.toNumberId(groupId));
  }

  async setGroupSyncEnabled(groupId: TabGroupId, enabled: boolean): Promise<void> {
    this.tabGroupManager.setSyncEnabled(this.toNumberId(groupId), enabled);
    if (enabled) {
      const numericId = this.toNumberId(groupId);
      const group = await this.tabGroupManager.getGroup(numericId);
      if (group) {
        await this.syncGroupToFolder(groupId);
      }
    }
  }

  async fullResyncGroup(group: chrome.tabGroups.TabGroup): Promise<void> {
    const opId = this.tracker.startOperation('fullResyncGroup', { 
      groupId: group.id,
      title: group.title 
    });

    return withErrorHandling(async () => {
      try {
        await withRetry('fullResync',
          () => this.tabGroupManager.fullResync(group),
          { maxAttempts: 3, delayMs: 1000 }
        );
        this.logger.info('fullResyncGroup:success', { 
          groupId: group.id,
          title: group.title
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

  async toggleSync(groupId: TabGroupId): Promise<void> {
    return withErrorHandling(async () => {
      const mapping = await this.storage.getMapping(groupId);
      if (!mapping) return;

      const newSyncEnabled = !mapping.syncEnabled;
      await this.storage.updateMapping(groupId, { syncEnabled: newSyncEnabled });

      if (newSyncEnabled) {
        await this.syncGroupToFolder(groupId);
      }
    }, ErrorType.SYNC);
  }

  async toggleUngroupedSync(): Promise<void> {
    return withErrorHandling(async () => {
      const settings = await this.storage.getUngroupedSettings();
      const newSyncEnabled = !settings.syncEnabled;

      await this.storage.updateUngroupedSettings({ syncEnabled: newSyncEnabled });

      if (newSyncEnabled) {
        await this.syncUngroupedTabs();
      }
    }, ErrorType.SYNC);
  }
}
