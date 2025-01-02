import { BookmarkManager } from './bookmarkManager';
import { StorageManager } from './storage/storageManager';
import { getTabsInGroup, getTab, getGroup } from './utils/tabUtils';
import { TabGroupId } from './types/storage';

export class TabGroupManager {
  private bookmarkManager: BookmarkManager;
  private storage: StorageManager;
  private updateDebounceTimers: Map<number, number>;
  private lastKnownTitles: Map<number, string>;

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

  // Enable/disable sync for a specific group
  setSyncEnabled(groupId: number, enabled: boolean): void {
    const stringId = this.toStringId(groupId);
    this.bookmarkManager.setSyncState(stringId, enabled);
  }

  // Get sync state for a specific group
  getSyncEnabled(groupId: number): boolean {
    const stringId = this.toStringId(groupId);
    return this.bookmarkManager.getSyncState(stringId);
  }

  // Perform a full resync of a group
  async fullResync(group: chrome.tabGroups.TabGroup): Promise<void> {
    const tabs = await getTabsInGroup(group.id);
    const stringId = this.toStringId(group.id);
    await this.bookmarkManager.fullResync(
      stringId,
      tabs,
      group.title || 'Unnamed Group'
    );
  }

  async handleGroupCreated(group: chrome.tabGroups.TabGroup): Promise<void> {
    if (!(await this.shouldSync())) {
      return;
    }

    // Set initial title in our tracking map
    this.lastKnownTitles.set(group.id, group.title || 'Unnamed Group');
    
    // Enable sync for new group by default
    this.setSyncEnabled(group.id, true);

    // For new groups, wait a bit before first sync to avoid partial titles
    this.debounce(group.id, async () => {
      const finalGroup = await this.getGroup(group.id);
      if (finalGroup) {
        const tabs = await getTabsInGroup(finalGroup.id);
        const stringId = this.toStringId(finalGroup.id);
        await this.bookmarkManager.syncGroupToFolder(
          stringId,
          tabs,
          finalGroup.title || 'Unnamed Group'
        );
      }
    }, 2000); // Wait 2 seconds for initial sync to allow for immediate title edits
  }

  async handleGroupUpdated(group: chrome.tabGroups.TabGroup): Promise<void> {
    // Only proceed if sync is enabled
    if (!(await this.shouldSync())) {
      return;
    }

    const lastTitle = this.lastKnownTitles.get(group.id);
    const currentTitle = group.title || 'Unnamed Group';

    // If this is a new group or the title has changed
    if (lastTitle !== currentTitle) {
      this.lastKnownTitles.set(group.id, currentTitle);

      // Debounce the sync operation
      this.debounce(group.id, async () => {
        // Double check if the title is still the same after debounce
        const finalGroup = await this.getGroup(group.id);
        if (finalGroup && finalGroup.title === currentTitle) {
          const tabs = await getTabsInGroup(group.id);
          const stringId = this.toStringId(group.id);
          await this.bookmarkManager.syncGroupToFolder(
            stringId,
            tabs,
            currentTitle
          );
        }
      });
    } else {
      // For non-title updates (like color changes), sync immediately
      const tabs = await getTabsInGroup(group.id);
      const stringId = this.toStringId(group.id);
      await this.bookmarkManager.syncGroupToFolder(
        stringId,
        tabs,
        currentTitle
      );
    }
  }

  async handleGroupRemoved(groupId: number): Promise<void> {
    // Clear any pending updates for this group
    const existingTimer = this.updateDebounceTimers.get(groupId);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      this.updateDebounceTimers.delete(groupId);
    }
    this.lastKnownTitles.delete(groupId);

    // When a group is removed we keep the bookmarks for future reference
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
