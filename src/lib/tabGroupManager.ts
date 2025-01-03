import { BookmarkManager } from './bookmarkManager';
import { StorageManager } from './storage/storageManager';
import { getTabsInGroup, getTab, getGroup } from './utils/tabUtils';
import { TabGroupId } from './types/storage';
import { Logger } from './utils/logger';

export class TabGroupManager {
  private bookmarkManager: BookmarkManager;
  private storage: StorageManager;
  private updateDebounceTimers: Map<number, number>;
  private lastKnownTitles: Map<number, string>;
  private logger = Logger.getInstance();

  constructor(bookmarkManager: BookmarkManager) {
    this.bookmarkManager = bookmarkManager;
    this.storage = new StorageManager();
    this.updateDebounceTimers = new Map();
    this.lastKnownTitles = new Map();
  }

  private toStringId(id: number): TabGroupId {
    return id.toString();
  }

  private debounce(groupId: number, callback: () => Promise<void>, delay: number = 1000): void {
    const existingTimer = this.updateDebounceTimers.get(groupId);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(async () => {
      await callback();
      this.updateDebounceTimers.delete(groupId);
    }, delay);

    this.updateDebounceTimers.set(groupId, timer);
  }

  private async shouldSync(groupId: number): Promise<boolean> {
    const stringId = this.toStringId(groupId);
    return this.storage.isSyncEnabled(stringId);
  }

  async getGroup(groupId: number): Promise<chrome.tabGroups.TabGroup | null> {
    return new Promise((resolve) => {
      chrome.tabGroups.get(groupId, (group) => {
        resolve(group || null);
      });
    });
  }

  async getGroupTabs(groupId: number): Promise<chrome.tabs.Tab[]> {
    return new Promise((resolve) => {
      chrome.tabs.query({ groupId }, resolve);
    });
  }

  async getUngroupedTabs(): Promise<chrome.tabs.Tab[]> {
    return new Promise((resolve) => {
      chrome.tabs.query(
        { groupId: chrome.tabGroups.TAB_GROUP_ID_NONE },
        resolve
      );
    });
  }

  // Enable/disable sync for a specific group
  async setSyncEnabled(groupId: number, enabled: boolean): Promise<void> {
    const stringId = this.toStringId(groupId);
    await this.storage.updateGroupSyncSettings(stringId, { enabled });
    
    if (enabled) {
      // Create folder and initial sync when enabling
      const group = await this.getGroup(groupId);
      if (group) {
        const tabs = await this.getGroupTabs(groupId);
        await this.bookmarkManager.syncGroupToFolder(stringId, tabs, group.title || 'Unnamed Group');
        this.logger.info('sync:enabled', { groupId: stringId, title: group.title });
      }
    } else {
      this.logger.info('sync:disabled', { groupId: stringId });
    }
  }

  // Get sync state for a specific group
  async getSyncEnabled(groupId: number): Promise<boolean> {
    const stringId = this.toStringId(groupId);
    return this.storage.isSyncEnabled(stringId);
  }

  // Perform a full resync of a group
  async fullResync(group: chrome.tabGroups.TabGroup): Promise<void> {
    const stringId = this.toStringId(group.id);
    if (!(await this.shouldSync(group.id))) {
      this.logger.warn('sync:skipped', { 
        groupId: stringId,
        reason: 'sync disabled',
        title: group.title
      });
      return;
    }

    this.logger.info('sync:fullResync:started', {
      groupId: stringId,
      title: group.title
    });

    try {
      const tabs = await getTabsInGroup(group.id);
      await this.bookmarkManager.fullResync(
        stringId,
        tabs,
        group.title || 'Unnamed Group'
      );
      this.logger.info('sync:fullResync:completed', {
        groupId: stringId,
        title: group.title,
        tabCount: tabs.length
      });
    } catch (error) {
      this.logger.error('sync:fullResync:failed', {
        groupId: stringId,
        title: group.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async handleGroupCreated(group: chrome.tabGroups.TabGroup): Promise<void> {
    const stringId = this.toStringId(group.id);
    this.logger.debug('group:created', {
      groupId: stringId,
      title: group.title,
      windowId: group.windowId
    });

    // Set initial title in our tracking map
    this.lastKnownTitles.set(group.id, group.title || 'Unnamed Group');
    
    // Start with sync disabled by default
    await this.setSyncEnabled(group.id, false);

    // For new groups, wait a bit before first sync to avoid partial titles
    this.debounce(group.id, async () => {
      if (!(await this.shouldSync(group.id))) return;

      const finalGroup = await this.getGroup(group.id);
      if (finalGroup) {
        const tabs = await getTabsInGroup(finalGroup.id);
        const stringId = this.toStringId(finalGroup.id);
        await this.bookmarkManager.syncGroupToFolder(
          stringId,
          tabs,
          finalGroup.title || 'Unnamed Group'
        );
        this.logger.info('sync:initialSync:completed', {
          groupId: stringId,
          title: finalGroup.title,
          tabCount: tabs.length
        });
      }
    }, 2000); // Wait 2 seconds for initial sync to allow for immediate title edits
  }

  async handleGroupUpdated(group: chrome.tabGroups.TabGroup): Promise<void> {
    const stringId = this.toStringId(group.id);
    this.logger.debug('group:updated', {
      groupId: stringId,
      title: group.title,
      windowId: group.windowId
    });

    // Only proceed if sync is enabled
    if (!(await this.shouldSync(group.id))) {
      return;
    }

    const lastTitle = this.lastKnownTitles.get(group.id);
    const currentTitle = group.title || 'Unnamed Group';

    // If this is a new group or the title has changed
    if (lastTitle !== currentTitle) {
      this.lastKnownTitles.set(group.id, currentTitle);
      this.logger.debug('group:titleChanged', {
        groupId: stringId,
        oldTitle: lastTitle,
        newTitle: currentTitle
      });

      // Debounce the sync operation
      this.debounce(group.id, async () => {
        // Double check if the title is still the same after debounce
        const finalGroup = await this.getGroup(group.id);
        if (finalGroup && finalGroup.title === currentTitle) {
          const tabs = await getTabsInGroup(group.id);
          await this.bookmarkManager.syncGroupToFolder(
            stringId,
            tabs,
            currentTitle
          );
          this.logger.info('sync:titleUpdate:completed', {
            groupId: stringId,
            title: currentTitle,
            tabCount: tabs.length
          });
        }
      });
    } else {
      // For non-title updates (like color changes), sync immediately
      const tabs = await getTabsInGroup(group.id);
      await this.bookmarkManager.syncGroupToFolder(
        stringId,
        tabs,
        currentTitle
      );
      this.logger.info('sync:update:completed', {
        groupId: stringId,
        title: currentTitle,
        tabCount: tabs.length
      });
    }
  }

  async handleGroupRemoved(groupId: number): Promise<void> {
    const stringId = this.toStringId(groupId);
    this.logger.debug('group:removed', {
      groupId: stringId,
      title: this.lastKnownTitles.get(groupId)
    });

    // Clear any pending updates for this group
    const existingTimer = this.updateDebounceTimers.get(groupId);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      this.updateDebounceTimers.delete(groupId);
    }
    this.lastKnownTitles.delete(groupId);

    // When a group is removed we keep the bookmarks for future reference
    this.logger.info('sync:groupRemoved', {
      groupId: stringId,
      action: 'bookmarks preserved'
    });
  }

  async handleTabAttached(
    tabId: number,
    attachInfo: chrome.tabs.TabAttachInfo
  ): Promise<void> {
    this.logger.debug('tab:attached', {
      tabId,
      newWindowId: attachInfo.newWindowId
    });

    if (attachInfo.newWindowId) {
      const tab = await getTab(tabId);
      if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const group = await getGroup(tab.groupId);
        await this.handleGroupUpdated(group);
      }
    }
  }

  async handleTabDetached(
    tabId: number,
    detachInfo: chrome.tabs.TabDetachInfo
  ): Promise<void> {
    this.logger.debug('tab:detached', {
      tabId,
      oldWindowId: detachInfo.oldWindowId
    });
  }
}
