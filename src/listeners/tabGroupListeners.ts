import { TabGroupManager } from '../lib/tabGroupManager';

export function initializeTabGroupListeners(tabGroupManager: TabGroupManager): void {
  chrome.tabGroups.onCreated.addListener(async (group) => {
    await tabGroupManager.handleGroupCreated(group);
  });

  chrome.tabGroups.onUpdated.addListener(async (group) => {
    await tabGroupManager.handleGroupUpdated(group);
  });

  chrome.tabGroups.onRemoved.addListener(async (group) => {
    await tabGroupManager.handleGroupRemoved(group.id);
  });
}