import { StorageManager } from './storage/storageManager';
import { SyncEngine } from './sync/syncEngine';
import { getTabsInGroup, getTab, getGroup } from './utils/tabUtils';
import { Logger } from './utils/logger';

export class TabGroupManager {
  private lastKnownTitles: Map<number, string>;
  private logger = Logger.getInstance();

  constructor(
    private readonly syncEngine: SyncEngine,
    private readonly storage: StorageManager
  ) {
    this.lastKnownTitles = new Map();
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

  async handleGroupVisible(group: chrome.tabGroups.TabGroup): Promise<void> {
    const name = group.title || 'Unnamed Group';
    this.logger.debug('group:visible', {
      groupId: group.id,
      name,
      windowId: group.windowId,
      type: 'created_or_restored'
    });

    // Set initial title in our tracking map
    this.lastKnownTitles.set(group.id, name);

    // Check if this group was previously synced
    const settings = await this.storage.getGroupSyncSettings(name);
    if (settings.enabled) {
      // Restore sync state
      const mapping = await this.storage.getMapping(name);
      if (!mapping || !mapping.syncEnabled) {
        // Update runtime mapping to match persisted preference
        await this.storage.updateMapping(name, {
          name,
          currentGroupId: group.id.toString(),
          color: group.color,
          syncEnabled: true,
          status: {
            lastSynced: settings.lastSynced ?? 0,
            inProgress: false
          }
        });
      }
    }

    // Notify sync engine of new group
    await this.syncEngine.handleGroupCreated(group);

    this.logger.info('group:created', {
      groupId: group.id,
      name,
      syncEnabled: settings.enabled
    });
  }

  async handleGroupUpdated(group: chrome.tabGroups.TabGroup): Promise<void> {
    const name = group.title || 'Unnamed Group';
    this.logger.debug('group:updated', {
      groupId: group.id,
      name,
      windowId: group.windowId
    });

    const lastTitle = this.lastKnownTitles.get(group.id);
    const currentTitle = name;

    // Track title changes
    if (lastTitle !== currentTitle) {
      this.lastKnownTitles.set(group.id, currentTitle);
      this.logger.debug('group:titleChanged', {
        groupId: group.id,
        oldTitle: lastTitle,
        newTitle: currentTitle
      });

      // If title changed, notify sync engine with old title for cleanup
      if (lastTitle) {
        await this.syncEngine.handleGroupRemoved(lastTitle);
      }
    }

    // Notify sync engine of group update
    await this.syncEngine.handleGroupUpdated(group);
  }

  async handleGroupRemoved(name: string): Promise<void> {
    this.logger.debug('group:removed', { name });

    // Clean up tracking - find and remove any IDs with this name
    for (const [id, title] of this.lastKnownTitles.entries()) {
      if (title === name) {
        this.lastKnownTitles.delete(id);
        this.logger.debug('group:tracking:removed', { id, name });
      }
    }

    // Notify sync engine of group removal
    await this.syncEngine.handleGroupRemoved(name);
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
