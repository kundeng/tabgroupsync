import { StorageManager } from './storage/storageManager';
import { SyncEngine } from './sync/syncEngine';
import { getTabsInGroup, getTab, getGroup } from './utils/tabUtils';
import { Logger } from './utils/logger';
import { resolveGroupName } from './utils/groupNameResolver';

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
    try {
      // First try direct lookup
      const group = await new Promise<chrome.tabGroups.TabGroup | null>((resolve) => {
        chrome.tabGroups.get(groupId, (group) => {
          resolve(group || null);
        });
      });
      
      if (group) return group;

      // If not found, check all windows
      const windows = await chrome.windows.getAll();
      for (const window of windows) {
        const groups = await chrome.tabGroups.query({ windowId: window.id });
        const match = groups.find(g => g.id === groupId);
        if (match) return match;
      }

      return null;
    } catch (error) {
      this.logger.error('getGroup:failed', {
        groupId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
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
    const name = resolveGroupName(group.title);
    this.logger.debug('group:visible', {
      groupId: group.id,
      name,
      windowId: group.windowId,
      type: 'created_or_restored'
    });

    // Skip unnamed/transient groups — they are not ready to sync
    if (name === null) {
      this.logger.info('group:visible:skipped', {
        groupId: group.id,
        reason: 'unnamed or whitespace-only title'
      });
      return;
    }

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
    const name = resolveGroupName(group.title);
    this.logger.debug('group:updated', {
      groupId: group.id,
      name,
      windowId: group.windowId
    });

    // If group is still unnamed, skip sync but track the ID
    if (name === null) {
      this.logger.info('group:updated:skipped', {
        groupId: group.id,
        reason: 'unnamed or whitespace-only title'
      });
      return;
    }

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

      // If the group was previously tracked under a different title, rename
      // the existing bookmark folder in-place rather than orphaning it.
      // Together with the listener-level debounce, this keeps renames correct
      // for any typing duration.
      if (lastTitle) {
        await this.syncEngine.handleGroupRenamed(lastTitle, currentTitle, group);
        return;
      }
    }

    // First title assignment, or non-rename update.
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

  async moveGroupToWindow(params: {
    sourceGroupId: number;
    sourceGroupName: string;
    targetWindowId: number;
  }): Promise<{ targetGroupId: number; movedTabCount: number }> {
    const sourceGroup = await this.getGroup(params.sourceGroupId);
    if (!sourceGroup) {
      throw new Error(`Source group ${params.sourceGroupId} not found`);
    }

    const tabs = await this.getGroupTabs(params.sourceGroupId);
    if (!tabs.length) {
      throw new Error('Source group has no tabs to move');
    }

    const sortedTabs = [...tabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const sourceTabIds = sortedTabs
      .map(tab => tab.id)
      .filter((id): id is number => typeof id === 'number');

    if (!sourceTabIds.length) {
      throw new Error('Could not determine source tab IDs');
    }

    const movedTabs = await chrome.tabs.move(sourceTabIds, {
      windowId: params.targetWindowId,
      index: -1
    });
    const movedTabList = Array.isArray(movedTabs) ? movedTabs : [movedTabs];
    const movedTabIds = movedTabList
      .map(tab => tab?.id)
      .filter((id): id is number => typeof id === 'number');

    if (!movedTabIds.length) {
      throw new Error('No tabs were moved to the target window');
    }

    const targetGroupId = await chrome.tabs.group({
      tabIds: movedTabIds,
      createProperties: { windowId: params.targetWindowId }
    });

    await chrome.tabGroups.update(targetGroupId, {
      title: sourceGroup.title,
      color: sourceGroup.color
    });

    const existingMapping = await this.storage.getMapping(params.sourceGroupName);
    this.syncEngine.registerMoveGuard(params.sourceGroupName, {
      sourceGroupId: params.sourceGroupId,
      targetGroupId
    });
    await this.storage.updateMapping(params.sourceGroupName, {
      name: params.sourceGroupName,
      currentGroupId: targetGroupId.toString(),
      color: sourceGroup.color,
      syncEnabled: existingMapping?.syncEnabled ?? true,
      status: {
        inProgress: false,
        error: undefined
      }
    });

    this.syncEngine.queueGroupSync(params.sourceGroupName);

    return {
      targetGroupId,
      movedTabCount: movedTabIds.length
    };
  }
}
