/**
 * Tab utility functions for filtering and manipulation
 */

/**
 * Get all tabs in a specific tab group
 */
export async function getTabsInGroup(groupId: number): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({ groupId }, resolve);
  });
}

/**
 * Get a specific tab by ID
 */
export async function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, resolve);
  });
}

/**
 * Get a specific tab group by ID
 */
export async function getGroup(groupId: number): Promise<chrome.tabGroups.TabGroup> {
  return new Promise((resolve) => {
    chrome.tabGroups.get(groupId, resolve);
  });
}

/**
 * Filter out ungrouped tabs (tabs with groupId === -1)
 * @param tabs - Array of tabs to filter
 * @returns Array of tabs that belong to a group
 */
export function filterGroupedTabs(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab[] {
  return tabs.filter((tab) => tab.groupId !== undefined && tab.groupId !== -1);
}

/**
 * Filter out tabs that don't belong to any group
 * @param tabs - Array of tabs to filter
 * @returns Array of ungrouped tabs
 */
export function filterUngroupedTabs(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab[] {
  return tabs.filter((tab) => tab.groupId === undefined || tab.groupId === -1);
}

/**
 * Check if a tab is in a group
 * @param tab - Tab to check
 * @returns true if the tab is in a group, false otherwise
 */
export function isTabGrouped(tab: chrome.tabs.Tab): boolean {
  return tab.groupId !== undefined && tab.groupId !== -1;
}

/**
 * Get all tabs in the current window
 */
export async function getAllTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({ currentWindow: true }, resolve);
  });
}

/**
 * Get all tab groups in the current window
 */
export async function getAllTabGroups(): Promise<chrome.tabGroups.TabGroup[]> {
  return new Promise((resolve) => {
    chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }, resolve);
  });
}

/**
 * Group tabs by their group ID
 * @param tabs - Array of tabs to group
 * @returns Map of group ID to array of tabs
 */
export function groupTabsByGroupId(tabs: chrome.tabs.Tab[]): Map<number, chrome.tabs.Tab[]> {
  const grouped = new Map<number, chrome.tabs.Tab[]>();

  for (const tab of tabs) {
    if (tab.groupId !== undefined && tab.groupId !== -1) {
      const existing = grouped.get(tab.groupId) || [];
      existing.push(tab);
      grouped.set(tab.groupId, existing);
    }
  }

  return grouped;
}

/**
 * Check if a tab has a valid URL for bookmarking
 * @param tab - Tab to check
 * @returns true if the tab URL can be bookmarked
 */
export function isValidBookmarkUrl(tab: chrome.tabs.Tab): boolean {
  if (!tab.url) return false;

  // Chrome doesn't allow bookmarking certain URLs
  const invalidPrefixes = ['chrome://', 'chrome-extension://', 'about:', 'data:', 'javascript:'];

  return !invalidPrefixes.some((prefix) => tab.url!.startsWith(prefix));
}

/**
 * Filter tabs to only those with valid bookmark URLs
 * @param tabs - Array of tabs to filter
 * @returns Array of tabs with valid bookmark URLs
 */
export function filterBookmarkableTabs(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab[] {
  return tabs.filter(isValidBookmarkUrl);
}
