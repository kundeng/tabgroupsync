import { BookmarkManager } from './bookmarkManager';
import { StorageManager } from './storage/storageManager';
import { getTabsInGroup, getTab, getGroup } from './utils/tabUtils';

export class TabGroupManager {
  private bookmarkManager: BookmarkManager;
  private storage: StorageManager;

  constructor(bookmarkManager: BookmarkManager) {
    this.bookmarkManager = bookmarkManager;
    this.storage = new StorageManager();
  }

  private async shouldSync(): Promise<boolean> {
    const settings = await this.storage.getSettings();
    return settings.autoSync && settings.parentFolderId !== undefined;
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

  async handleGroupCreated(group: chrome.tabGroups.TabGroup): Promise<void> {
    if (await this.shouldSync()) {
      const tabs = await getTabsInGroup(group.id);
      await this.bookmarkManager.syncGroupToFolder(
        group.id,
        tabs,
        group.title || 'Unnamed Group'
      );
    }
  }

  async handleGroupUpdated(group: chrome.tabGroups.TabGroup): Promise<void> {
    if (await this.shouldSync()) {
      const tabs = await getTabsInGroup(group.id);
      await this.bookmarkManager.syncGroupToFolder(
        group.id,
        tabs,
        group.title || 'Unnamed Group'
      );
    }
  }

  async handleGroupRemoved(groupId: number): Promise<void> {
    // When a group is removed, we keep the bookmarks for future reference
    console.log('Tab group removed:', groupId);
  }

  async handleTabAttached(
    tabId: number,
    attachInfo: chrome.tabs.TabAttachInfo
  ): Promise<void> {
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
    console.log('Tab detached:', tabId, detachInfo);
  }
}
