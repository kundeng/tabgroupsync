import { vi } from 'vitest';

// Mock Chrome APIs with promise-based implementations
global.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  storage: {
    sync: {
      get: vi.fn((keys, callback) => {
        const result = {};
        if (callback) callback(result);
        return Promise.resolve(result);
      }),
      set: vi.fn((items, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
      clear: vi.fn((callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
      remove: vi.fn((keys, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
    },
    local: {
      get: vi.fn((keys, callback) => {
        const result = {};
        if (callback) callback(result);
        return Promise.resolve(result);
      }),
      set: vi.fn((items, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
      clear: vi.fn((callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
    },
  },
  bookmarks: {
    create: vi.fn((bookmark, callback) => {
      const result = {
        id: `bookmark-${Date.now()}`,
        title: bookmark.title,
        url: bookmark.url,
        parentId: bookmark.parentId,
        index: 0,
        dateAdded: Date.now(),
      };
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    get: vi.fn((id, callback) => {
      const result: chrome.bookmarks.BookmarkTreeNode[] = [];
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    getChildren: vi.fn((id, callback) => {
      const result: chrome.bookmarks.BookmarkTreeNode[] = [];
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    update: vi.fn((id, changes, callback) => {
      const result = {
        id,
        title: changes.title || 'Updated',
        parentId: 'parent-1',
        index: 0,
        dateAdded: Date.now(),
      };
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    remove: vi.fn((id, callback) => {
      if (callback) callback();
      return Promise.resolve();
    }),
    removeTree: vi.fn((id, callback) => {
      if (callback) callback();
      return Promise.resolve();
    }),
    getTree: vi.fn((callback) => {
      const result: chrome.bookmarks.BookmarkTreeNode[] = [];
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    search: vi.fn((query, callback) => {
      const result: chrome.bookmarks.BookmarkTreeNode[] = [];
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
  },
  tabGroups: {
    query: vi.fn((queryInfo, callback) => {
      const result: chrome.tabGroups.TabGroup[] = [];
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    get: vi.fn((groupId, callback) => {
      const result = {
        id: groupId,
        title: 'Test Group',
        color: 'grey' as chrome.tabGroups.ColorEnum,
        windowId: 1,
        collapsed: false,
      };
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    update: vi.fn((groupId, updateProperties, callback) => {
      const result = {
        id: groupId,
        title: updateProperties.title || 'Test Group',
        color: (updateProperties.color || 'grey') as chrome.tabGroups.ColorEnum,
        windowId: 1,
        collapsed: updateProperties.collapsed || false,
      };
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
  },
  tabs: {
    query: vi.fn((queryInfo, callback) => {
      const result: chrome.tabs.Tab[] = [];
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    get: vi.fn((tabId, callback) => {
      const result = {
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
    }),
    create: vi.fn((createProperties, callback) => {
      const result = {
        id: Date.now(),
        url: createProperties.url || 'https://example.com',
        title: 'New Tab',
        windowId: createProperties.windowId || 1,
        index: 0,
        pinned: false,
        highlighted: false,
        active: true,
        incognito: false,
        groupId: -1,
      };
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    update: vi.fn((tabId, updateProperties, callback) => {
      const result = {
        id: tabId,
        url: updateProperties.url || 'https://example.com',
        title: 'Updated Tab',
        windowId: 1,
        index: 0,
        pinned: updateProperties.pinned || false,
        highlighted: false,
        active: updateProperties.active || false,
        incognito: false,
        groupId: -1,
      };
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
    remove: vi.fn((tabId, callback) => {
      if (callback) callback();
      return Promise.resolve();
    }),
    group: vi.fn((options, callback) => {
      const result = Date.now();
      if (callback) callback(result);
      return Promise.resolve(result);
    }),
  },
} as any;

// Mock Performance API
global.performance = {
  mark: vi.fn(),
  measure: vi.fn(),
  clearMarks: vi.fn(),
  clearMeasures: vi.fn(),
  getEntriesByName: vi.fn(),
  getEntriesByType: vi.fn(),
  now: vi.fn(() => Date.now()),
} as any;

// Mock console methods to avoid cluttering test output
global.console = {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};
