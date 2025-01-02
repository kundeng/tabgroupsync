import { TabGroupManager } from '../lib/tabGroupManager';

export function initializeTabListeners(tabGroupManager: TabGroupManager): void {
  chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
    await tabGroupManager.handleTabAttached(tabId, attachInfo);
  });

  chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
    await tabGroupManager.handleTabDetached(tabId, detachInfo);
  });
}