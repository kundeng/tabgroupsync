/**
 * Test utilities for property-based testing
 * 
 * This file contains helper functions for setting up Chrome API mocks
 * and common test scenarios.
 */

import { vi } from 'vitest';

/**
 * Storage for created bookmarks during tests
 */
export interface TestBookmarkStorage {
  bookmarks: Map<string, chrome.bookmarks.BookmarkTreeNode>;
  folders: Map<string, chrome.bookmarks.BookmarkTreeNode>;
  children: Map<string, chrome.bookmarks.BookmarkTreeNode[]>;
}

/**
 * Creates a fresh bookmark storage for testing
 */
export function createBookmarkStorage(): TestBookmarkStorage {
  return {
    bookmarks: new Map(),
    folders: new Map(),
    children: new Map(),
  };
}

/**
 * Sets up Chrome bookmark API mocks with promise-based implementations
 * 
 * @param storage - Test bookmark storage to use
 * @returns Cleanup function to reset mocks
 */
export function setupBookmarkMocks(storage: TestBookmarkStorage) {
  let bookmarkIdCounter = 1;

  vi.mocked(chrome.bookmarks.create).mockImplementation((bookmark: any, callback?: any) => {
    const newBookmark: chrome.bookmarks.BookmarkTreeNode = {
      id: bookmark.url ? `bookmark-${bookmarkIdCounter++}` : `folder-${bookmarkIdCounter++}`,
      title: bookmark.title,
      url: bookmark.url,
      parentId: bookmark.parentId,
      index: bookmark.index ?? 0,
      dateAdded: Date.now(),
    };

    if (bookmark.url) {
      storage.bookmarks.set(newBookmark.id, newBookmark);
    } else {
      storage.folders.set(newBookmark.id, newBookmark);
      storage.children.set(newBookmark.id, []);
    }

    // Add to parent's children
    if (bookmark.parentId) {
      const parentChildren = storage.children.get(bookmark.parentId) || [];
      parentChildren.push(newBookmark);
      storage.children.set(bookmark.parentId, parentChildren);
    }

    if (callback) callback(newBookmark);
    return Promise.resolve(newBookmark);
  });

  vi.mocked(chrome.bookmarks.get).mockImplementation((id: string | string[], callback?: any) => {
    const ids = Array.isArray(id) ? id : [id];
    const result: chrome.bookmarks.BookmarkTreeNode[] = [];

    for (const nodeId of ids) {
      const bookmark = storage.bookmarks.get(nodeId) || storage.folders.get(nodeId);
      if (bookmark) {
        result.push(bookmark);
      }
    }

    if (callback) callback(result);
    return Promise.resolve(result);
  });

  vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: string, callback?: any) => {
    const result = storage.children.get(id) || [];
    if (callback) callback(result);
    return Promise.resolve(result);
  });

  vi.mocked(chrome.bookmarks.update).mockImplementation((id: string, changes: any, callback?: any) => {
    const bookmark = storage.bookmarks.get(id) || storage.folders.get(id);
    if (bookmark) {
      const updated = { ...bookmark, ...changes };
      if (bookmark.url) {
        storage.bookmarks.set(id, updated);
      } else {
        storage.folders.set(id, updated);
      }
      if (callback) callback(updated);
      return Promise.resolve(updated);
    }

    const fallback = {
      id,
      title: changes.title || 'Updated',
      parentId: 'parent-1',
      index: 0,
      dateAdded: Date.now(),
    };
    if (callback) callback(fallback);
    return Promise.resolve(fallback);
  });

  vi.mocked(chrome.bookmarks.remove).mockImplementation((id: string, callback?: any) => {
    storage.bookmarks.delete(id);
    storage.folders.delete(id);
    storage.children.delete(id);

    // Remove from parent's children
    for (const [parentId, children] of storage.children.entries()) {
      const filtered = children.filter(child => child.id !== id);
      storage.children.set(parentId, filtered);
    }

    if (callback) callback();
    return Promise.resolve();
  });

  vi.mocked(chrome.bookmarks.removeTree).mockImplementation((id: string, callback?: any) => {
    // Recursively remove all children
    const children = storage.children.get(id) || [];
    for (const child of children) {
      if (child.url) {
        storage.bookmarks.delete(child.id);
      } else {
        // Recursively remove folder
        const removeTreeMock = vi.mocked(chrome.bookmarks.removeTree);
        removeTreeMock(child.id);
      }
    }

    storage.folders.delete(id);
    storage.children.delete(id);

    // Remove from parent's children
    for (const [parentId, children] of storage.children.entries()) {
      const filtered = children.filter(child => child.id !== id);
      storage.children.set(parentId, filtered);
    }

    if (callback) callback();
    return Promise.resolve();
  });

  vi.mocked(chrome.bookmarks.search).mockImplementation((query: any, callback?: any) => {
    const searchTerm = typeof query === 'string' ? query : query.title || query.url || '';
    const result: chrome.bookmarks.BookmarkTreeNode[] = [];

    for (const bookmark of storage.bookmarks.values()) {
      if (bookmark.title?.includes(searchTerm) || bookmark.url?.includes(searchTerm)) {
        result.push(bookmark);
      }
    }

    for (const folder of storage.folders.values()) {
      if (folder.title?.includes(searchTerm)) {
        result.push(folder);
      }
    }

    if (callback) callback(result);
    return Promise.resolve(result);
  });

  return () => {
    vi.clearAllMocks();
  };
}

/**
 * Sets up Chrome storage API mocks with promise-based implementations
 * 
 * @param initialData - Initial data to populate storage with
 * @returns Object with storage data and cleanup function
 */
export function setupStorageMocks(initialData: Record<string, any> = {}) {
  const storageData = { ...initialData };

  vi.mocked(chrome.storage.sync.get).mockImplementation((keys: any, callback?: any) => {
    let result: Record<string, any> = {};

    if (keys === null || keys === undefined) {
      result = { ...storageData };
    } else if (typeof keys === 'string') {
      if (keys in storageData) {
        result[keys] = storageData[keys];
      }
    } else if (Array.isArray(keys)) {
      for (const key of keys) {
        if (key in storageData) {
          result[key] = storageData[key];
        }
      }
    } else if (typeof keys === 'object') {
      result = { ...keys };
      for (const key in keys) {
        if (key in storageData) {
          result[key] = storageData[key];
        }
      }
    }

    if (callback) callback(result);
    return Promise.resolve(result);
  });

  vi.mocked(chrome.storage.sync.set).mockImplementation((items: any, callback?: any) => {
    Object.assign(storageData, items);
    if (callback) callback();
    return Promise.resolve();
  });

  vi.mocked(chrome.storage.sync.remove).mockImplementation((keys: string | string[], callback?: any) => {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    for (const key of keysArray) {
      delete storageData[key];
    }
    if (callback) callback();
    return Promise.resolve();
  });

  vi.mocked(chrome.storage.sync.clear).mockImplementation((callback?: any) => {
    for (const key in storageData) {
      delete storageData[key];
    }
    if (callback) callback();
    return Promise.resolve();
  });

  return {
    storageData,
    cleanup: () => {
      vi.clearAllMocks();
    },
  };
}

/**
 * Sets up Chrome tab group API mocks with promise-based implementations
 * 
 * @returns Object with tab group storage and cleanup function
 */
export function setupTabGroupMocks() {
  const tabGroups = new Map<number, chrome.tabGroups.TabGroup>();

  vi.mocked(chrome.tabGroups.query).mockImplementation((queryInfo: any, callback?: any) => {
    let result = Array.from(tabGroups.values());

    if (queryInfo.windowId !== undefined) {
      result = result.filter(g => g.windowId === queryInfo.windowId);
    }
    if (queryInfo.collapsed !== undefined) {
      result = result.filter(g => g.collapsed === queryInfo.collapsed);
    }

    if (callback) callback(result);
    return Promise.resolve(result);
  });

  vi.mocked(chrome.tabGroups.get).mockImplementation((groupId: number, callback?: any) => {
    const group = tabGroups.get(groupId);
    const result = group || {
      id: groupId,
      title: 'Test Group',
      color: 'grey' as chrome.tabGroups.ColorEnum,
      windowId: 1,
      collapsed: false,
    };
    if (callback) callback(result);
    return Promise.resolve(result);
  });

  vi.mocked(chrome.tabGroups.update).mockImplementation((groupId: number, updateProperties: any, callback?: any) => {
    const existing = tabGroups.get(groupId);
    const updated = {
      id: groupId,
      title: updateProperties.title ?? existing?.title ?? 'Test Group',
      color: (updateProperties.color ?? existing?.color ?? 'grey') as chrome.tabGroups.ColorEnum,
      windowId: existing?.windowId ?? 1,
      collapsed: updateProperties.collapsed ?? existing?.collapsed ?? false,
    };
    tabGroups.set(groupId, updated);
    if (callback) callback(updated);
    return Promise.resolve(updated);
  });

  return {
    tabGroups,
    cleanup: () => {
      tabGroups.clear();
      vi.clearAllMocks();
    },
  };
}

/**
 * Sets up Chrome tabs API mocks with promise-based implementations
 * 
 * @returns Object with tabs storage and cleanup function
 */
export function setupTabsMocks() {
  const tabs = new Map<number, chrome.tabs.Tab>();
  let tabIdCounter = 1;

  vi.mocked(chrome.tabs.query).mockImplementation((queryInfo: any, callback?: any) => {
    let result = Array.from(tabs.values());

    if (queryInfo.groupId !== undefined) {
      result = result.filter(t => t.groupId === queryInfo.groupId);
    }
    if (queryInfo.windowId !== undefined) {
      result = result.filter(t => t.windowId === queryInfo.windowId);
    }
    if (queryInfo.pinned !== undefined) {
      result = result.filter(t => t.pinned === queryInfo.pinned);
    }
    if (queryInfo.active !== undefined) {
      result = result.filter(t => t.active === queryInfo.active);
    }

    if (callback) callback(result);
    return Promise.resolve(result);
  });

  vi.mocked(chrome.tabs.get).mockImplementation((tabId: number, callback?: any) => {
    const tab = tabs.get(tabId);
    const result = tab || {
      id: tabId,
      url: 'https://example.com',
      title: 'Test Tab',
      windowId: 1,
      index: 0,
      pinned: false,
      highlighted: false,
      active: false,
      incognito: false,
      groupId: -1,
    };
    if (callback) callback(result);
    return Promise.resolve(result);
  });

  vi.mocked(chrome.tabs.create).mockImplementation((createProperties: any, callback?: any) => {
    const newTab: chrome.tabs.Tab = {
      id: tabIdCounter++,
      url: createProperties.url || 'https://example.com',
      title: 'New Tab',
      windowId: createProperties.windowId || 1,
      index: createProperties.index ?? 0,
      pinned: createProperties.pinned || false,
      highlighted: false,
      active: createProperties.active ?? true,
      incognito: false,
      groupId: -1,
    };
    tabs.set(newTab.id!, newTab);
    if (callback) callback(newTab);
    return Promise.resolve(newTab);
  });

  vi.mocked(chrome.tabs.update).mockImplementation((tabId: number, updateProperties: any, callback?: any) => {
    const existing = tabs.get(tabId);
    const updated: chrome.tabs.Tab = {
      id: tabId,
      url: updateProperties.url ?? existing?.url ?? 'https://example.com',
      title: existing?.title ?? 'Updated Tab',
      windowId: existing?.windowId ?? 1,
      index: existing?.index ?? 0,
      pinned: updateProperties.pinned ?? existing?.pinned ?? false,
      highlighted: existing?.highlighted ?? false,
      active: updateProperties.active ?? existing?.active ?? false,
      incognito: existing?.incognito ?? false,
      groupId: existing?.groupId ?? -1,
    };
    tabs.set(tabId, updated);
    if (callback) callback(updated);
    return Promise.resolve(updated);
  });

  vi.mocked(chrome.tabs.remove).mockImplementation((tabId: number | number[], callback?: any) => {
    const ids = Array.isArray(tabId) ? tabId : [tabId];
    for (const id of ids) {
      tabs.delete(id);
    }
    if (callback) callback();
    return Promise.resolve();
  });

  vi.mocked(chrome.tabs.group).mockImplementation((options: any, callback?: any) => {
    const groupId = Date.now();
    const tabIds = Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds];
    
    for (const tabId of tabIds) {
      const tab = tabs.get(tabId);
      if (tab) {
        tab.groupId = groupId;
        tabs.set(tabId, tab);
      }
    }

    if (callback) callback(groupId);
    return Promise.resolve(groupId);
  });

  return {
    tabs,
    cleanup: () => {
      tabs.clear();
      vi.clearAllMocks();
    },
  };
}

/**
 * Sets up all Chrome API mocks for comprehensive testing
 * 
 * @param options - Configuration options for mock setup
 * @returns Object with all storage references and cleanup function
 */
export function setupAllMocks(options: {
  initialStorage?: Record<string, any>;
} = {}) {
  const bookmarkStorage = createBookmarkStorage();
  const bookmarkCleanup = setupBookmarkMocks(bookmarkStorage);
  const { storageData, cleanup: storageCleanup } = setupStorageMocks(options.initialStorage);
  const { tabGroups, cleanup: tabGroupCleanup } = setupTabGroupMocks();
  const { tabs, cleanup: tabsCleanup } = setupTabsMocks();

  return {
    bookmarkStorage,
    storageData,
    tabGroups,
    tabs,
    cleanup: () => {
      bookmarkCleanup();
      storageCleanup();
      tabGroupCleanup();
      tabsCleanup();
    },
  };
}

/**
 * Helper to create a valid tab with sensible defaults
 */
export function createTestTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: Date.now(),
    url: 'https://example.com',
    title: 'Test Tab',
    windowId: 1,
    index: 0,
    pinned: false,
    highlighted: false,
    active: false,
    incognito: false,
    groupId: -1,
    ...overrides,
  };
}

/**
 * Helper to create a valid tab group with sensible defaults
 */
export function createTestTabGroup(overrides: Partial<chrome.tabGroups.TabGroup> = {}): chrome.tabGroups.TabGroup {
  return {
    id: Date.now(),
    title: 'Test Group',
    color: 'grey' as chrome.tabGroups.ColorEnum,
    windowId: 1,
    collapsed: false,
    ...overrides,
  };
}

/**
 * Helper to create a valid bookmark with sensible defaults
 */
export function createTestBookmark(overrides: Partial<chrome.bookmarks.BookmarkTreeNode> = {}): chrome.bookmarks.BookmarkTreeNode {
  return {
    id: `bookmark-${Date.now()}`,
    title: 'Test Bookmark',
    url: 'https://example.com',
    parentId: 'parent-1',
    index: 0,
    dateAdded: Date.now(),
    ...overrides,
  };
}
