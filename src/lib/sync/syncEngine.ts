import { StorageManager } from '../storage/storageManager';
import { BookmarkManager } from '../bookmarkManager';
import { TabGroupManager } from '../tabGroupManager';
import { SyncError, ErrorType, withErrorHandling } from '../utils/errors';
import { GroupFolderMapping, TabGroupId, BookmarkFolderId } from '../types/storage';

export class SyncEngine {
  constructor(
    private storage: StorageManager,
    private bookmarkManager: BookmarkManager,
    private tabGroupManager: TabGroupManager
  ) {}

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
    return withErrorHandling(async () => {
      const mapping = await this.storage.getMapping(groupId);
      if (!mapping || !mapping.syncEnabled) return;

      // Update sync status
      await this.storage.updateMapping(groupId, {
        status: { lastSynced: Date.now(), inProgress: true }
      });

      try {
        const group = await this.tabGroupManager.getGroup(groupId);
        if (!group) {
          throw new SyncError(`Tab group ${groupId} not found`);
        }

        const tabs = await this.tabGroupManager.getGroupTabs(groupId);
        await this.bookmarkManager.syncGroupToFolder(groupId, tabs, group.title || 'Unnamed Group');

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
      }
    }, ErrorType.SYNC);
  }

  async syncFolderToGroup(folderId: BookmarkFolderId): Promise<void> {
    return withErrorHandling(async () => {
      const mapping = await this.storage.getFolderMapping(folderId);
      if (!mapping || !mapping.syncEnabled) return;

      try {
        await this.bookmarkManager.createTabGroupFromFolder(folderId);

        // Add success entry to history
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'folder-to-group',
          groupId: mapping.groupId,
          folderId,
          success: true
        });
      } catch (error) {
        // Add failure entry to history
        await this.storage.addHistoryEntry({
          timestamp: Date.now(),
          type: 'folder-to-group',
          groupId: mapping.groupId,
          folderId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        throw error;
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
