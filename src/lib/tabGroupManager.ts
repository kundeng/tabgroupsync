import { StorageManager } from './storage/storageManager';
import { SyncEngine } from './sync/syncEngine';
import { getTabsInGroup, getTab, getGroup } from './utils/tabUtils';
import { Logger } from './utils/logger';
import { resolveGroupName } from './utils/groupNameResolver';

export class TabGroupManager {
  private lastKnownTitles: Map<number, string>;
  private pendingTitleChecks: Set<number> = new Set();
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

    // Skip unnamed/transient groups — but schedule deferred title check
    // because onUpdated with the new title may not always fire in the
    // background service worker (e.g., when title is set from popup context).
    if (name === null) {
      this.logger.info('group:visible:skipped', {
        groupId: group.id,
        reason: 'unnamed or whitespace-only title — scheduling deferred check'
      });
      this.scheduleDeferredTitleCheck(group.id);
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

  private scheduleDeferredTitleCheck(groupId: number): void {
    // Prevent duplicate deferred checks for the same group
    if (this.pendingTitleChecks.has(groupId)) return;
    this.pendingTitleChecks.add(groupId);

    const POLL_INTERVAL = 2000; // 2 seconds between checks
    const MAX_CHECKS = 5;       // Check up to 5 times (10 seconds total)
    let checks = 0;

    const check = async () => {
      checks++;
      try {
        const group = await this.getGroup(groupId);
        if (!group) {
          this.logger.debug('deferredTitleCheck:groupGone', { groupId, checks });
          this.pendingTitleChecks.delete(groupId);
          return; // Group was removed, stop checking
        }

        const name = resolveGroupName(group.title);
        if (name !== null && !this.lastKnownTitles.has(groupId)) {
          // Title appeared! Check if sync was already set up by another path
          // (e.g., user toggled sync via UI, or another SW instance handled it)
          const existingSettings = await this.storage.getGroupSyncSettings(name);
          if (existingSettings.enabled) {
            this.logger.info('deferredTitleCheck:alreadyEnabled', {
              groupId,
              title: group.title,
              checks
            });
            this.pendingTitleChecks.delete(groupId);
            this.lastKnownTitles.set(groupId, name);
            return;
          }

          // Process as a new named group
          this.logger.info('deferredTitleCheck:titleFound', {
            groupId,
            title: group.title,
            checks
          });
          this.pendingTitleChecks.delete(groupId);
          this.lastKnownTitles.set(groupId, name);
          await this.syncEngine.handleGroupCreated(group);
          return;
        }

        // If title was already handled (e.g., by onUpdated), stop
        if (this.lastKnownTitles.has(groupId)) {
          this.pendingTitleChecks.delete(groupId);
          return;
        }

        if (checks < MAX_CHECKS) {
          setTimeout(check, POLL_INTERVAL);
        } else {
          this.logger.debug('deferredTitleCheck:gaveUp', { groupId, checks });
          this.pendingTitleChecks.delete(groupId);
        }
      } catch (error) {
        this.logger.error('deferredTitleCheck:failed', {
          groupId,
          checks,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        this.pendingTitleChecks.delete(groupId);
      }
    };

    setTimeout(check, POLL_INTERVAL);
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

      // If title changed, notify sync engine with old title for cleanup
      // Per Req 1.4: title changes create a new folder, old folder preserved
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
