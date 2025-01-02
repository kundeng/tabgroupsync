export async function getTabsInGroup(groupId: number): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({ groupId }, resolve);
  });
}

export async function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, resolve);
  });
}

export async function getGroup(groupId: number): Promise<chrome.tabGroups.TabGroup> {
  return new Promise((resolve) => {
    chrome.tabGroups.get(groupId, resolve);
  });
}