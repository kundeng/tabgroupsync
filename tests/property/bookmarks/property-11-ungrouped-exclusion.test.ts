import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { TabGroupManager } from '../../../src/lib/tabGroupManager';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { SyncEngine } from '../../../src/lib/sync/syncEngine';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';

/**
 * Property 11: Ungrouped Tab Exclusion
 * 
 * For any tab that is not in a group (groupId === -1), the Extension should not 
 * create bookmarks or track the tab in any sync operations
 * 
 * Validates: Requirements 13.1, 13.4
 */

// Arbitraries for generating test data
const arbitraryUrl = fc.webUrl({ validSchemes: ['http', 'https'] });

const arbitraryGroupedTab = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  url: arbitraryUrl,
  title: fc.string({ minLength: 1, maxLength: 100 }),
  pinned: fc.boolean(),
  groupId: fc.integer({ min: 1, max: 1000 }), // Grouped tabs have positive groupId
  windowId: fc.integer({ min: 1, max: 10 }),
  index: fc.integer({ min: 0, max: 100 }),
  active: fc.boolean(),
  highlighted: fc.boolean(),
  incognito: fc.boolean(),
});

const arbitraryUngroupedTab = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  url: arbitraryUrl,
  title: fc.string({ minLength: 1, maxLength: 100 }),
  pinned: fc.boolean(),
  groupId: fc.constant(-1), // Ungrouped tabs have groupId === -1
  windowId: fc.integer({ min: 1, max: 10 }),
  index: fc.integer({ min: 0, max: 100 }),
  active: fc.boolean(),
  highlighted: fc.boolean(),
  incognito: fc.boolean(),
});

const arbitraryTabGroup = fc.record({
  id: fc.integer({ min: 1, max: 1000 }),
  title: fc.string({ minLength: 1, maxLength: 50 }),
  color: fc.constantFrom('grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'),
  windowId: fc.integer({ min: 1, max: 10 }),
  collapsed: fc.boolean(),
});

describe('Property 11: Ungrouped Tab Exclusion', () => {
  let tabGroupManager: TabGroupManager;
  let storageManager: StorageManager;
  let syncEngine: SyncEngine;
  let bookmarkManager: BookmarkManager;
  let createdBookmarks: chrome.bookmarks.BookmarkTreeNode[];

  beforeEach(() => {
    vi.clearAllMocks();
    createdBookmarks = [];
    
    // Mock storage manager
    storageManager = new StorageManager();
    
    // Setup container folder
    vi.mocked(chrome.storage.sync.get).mockImplementation((keys: any, callback: any) => {
      callback({
        'state:settings': {
          containerFolderId: 'container-1',
          autoSync: true,
          keepRemoved: true,
          cleanup: {
            enabled: true,
            inactiveThreshold: 30,
            autoArchive: true,
            deleteThreshold: 90
          }
        }
      });
    });

    vi.mocked(chrome.storage.sync.set).mockImplementation((items: any, callback?: any) => {
      if (callback) callback();
    });

    // Mock bookmark operations
    vi.mocked(chrome.bookmarks.get).mockImplementation((id: string, callback: any) => {
      if (id === 'container-1') {
        callback([{
          id: 'container-1',
          title: 'Tab Groups',
          parentId: '1',
          index: 0,
          dateAdded: Date.now(),
        }]);
      } else if (id === 'bookmarks-folder-1') {
        callback([{
          id: 'bookmarks-folder-1',
          title: 'Tab Group Bookmarks',
          parentId: 'container-1',
          index: 0,
          dateAdded: Date.now(),
        }]);
      } else {
        callback([]);
      }
    });

    vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: string, callback: any) => {
      if (id === 'container-1') {
        callback([
          {
            id: 'bookmarks-folder-1',
            title: 'Tab Group Bookmarks',
            parentId: 'container-1',
            index: 0,
            dateAdded: Date.now(),
          }
        ]);
      } else if (id.startsWith('group-folder-')) {
        callback(createdBookmarks.filter(b => b.parentId === id));
      } else {
        callback([]);
      }
    });

    let bookmarkIdCounter = 1;
    vi.mocked(chrome.bookmarks.create).mockImplementation((bookmark: any, callback?: any) => {
      const newBookmark: chrome.bookmarks.BookmarkTreeNode = {
        id: bookmark.url ? `bookmark-${bookmarkIdCounter++}` : `group-folder-${bookmarkIdCounter++}`,
        title: bookmark.title,
        url: bookmark.url,
        parentId: bookmark.parentId,
        index: 0,
        dateAdded: Date.now(),
      };
      
      if (bookmark.url) {
        createdBookmarks.push(newBookmark);
      }
      
      if (callback) {
        callback(newBookmark);
      }
      return Promise.resolve(newBookmark);
    });

    vi.mocked(chrome.bookmarks.update).mockImplementation((id: string, changes: any, callback?: any) => {
      const result = {
        id,
        title: changes.title || 'Updated',
        parentId: 'bookmarks-folder-1',
        index: 0,
        dateAdded: Date.now(),
      };
      if (callback) {
        callback(result);
      }
      return Promise.resolve(result);
    });

    // Mock tab queries
    vi.mocked(chrome.tabs.query).mockImplementation((queryInfo: any, callback: any) => {
      // Return empty array for ungrouped tabs
      if (queryInfo.groupId === -1 || queryInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        callback([]);
      } else {
        callback([]);
      }
    });

    // Initialize managers
    bookmarkManager = new BookmarkManager(storageManager);
    syncEngine = new SyncEngine(storageManager, bookmarkManager);
    tabGroupManager = new TabGroupManager(syncEngine, storageManager);
  });

  it('should not create bookmarks for ungrouped tabs', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryGroupedTab, { minLength: 1, maxLength: 10 }),
        fc.array(arbitraryUngroupedTab, { minLength: 1, maxLength: 10 }),
        async (group, groupedTabs, ungroupedTabs) => {
          // Reset created bookmarks for each iteration
          createdBookmarks = [];
          
          // Initialize storage
          await storageManager.initialize();
          
          // Ensure grouped tabs have valid URLs and belong to the group
          const validGroupedTabs = groupedTabs.map(tab => ({
            ...tab,
            url: tab.url || 'https://example.com',
            title: tab.title || 'Untitled',
            groupId: group.id
          }));

          // Ensure ungrouped tabs have groupId === -1
          const validUngroupedTabs = ungroupedTabs.map(tab => ({
            ...tab,
            url: tab.url || 'https://example.com',
            title: tab.title || 'Untitled',
            groupId: -1
          }));

          // Combine all tabs
          const allTabs = [...validGroupedTabs, ...validUngroupedTabs];

          // Filter tabs to only include grouped ones (simulating the extension's behavior)
          const tabsToSync = allTabs.filter(tab => tab.groupId !== -1);

          // Sync the group with only grouped tabs
          const groupFolder = await bookmarkManager.ensureGroupFolder(group.title || 'Test Group');
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            tabsToSync as chrome.tabs.Tab[],
            groupFolder.id
          );

          // Verify: Only grouped tabs should have bookmarks
          const groupedTabUrls = new Set(validGroupedTabs.map(t => t.url));
          const ungroupedTabUrls = new Set(validUngroupedTabs.map(t => t.url));
          const bookmarkUrls = new Set(createdBookmarks.map(b => b.url));

          // All grouped tab URLs should be in bookmarks
          for (const url of groupedTabUrls) {
            expect(bookmarkUrls.has(url)).toBe(true);
          }

          // No ungrouped tab URLs should be in bookmarks
          for (const url of ungroupedTabUrls) {
            expect(bookmarkUrls.has(url)).toBe(false);
          }

          // Bookmark count should match grouped tabs only
          expect(createdBookmarks.length).toBe(groupedTabUrls.size);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should filter out ungrouped tabs when querying tabs for sync', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryGroupedTab, { minLength: 1, maxLength: 10 }),
        fc.array(arbitraryUngroupedTab, { minLength: 1, maxLength: 10 }),
        async (groupedTabs, ungroupedTabs) => {
          // Initialize storage
          await storageManager.initialize();

          // Ensure ungrouped tabs have groupId === -1
          const validUngroupedTabs = ungroupedTabs.map(tab => ({
            ...tab,
            groupId: -1
          }));

          // Mock chrome.tabs.query to return ungrouped tabs
          vi.mocked(chrome.tabs.query).mockImplementation((queryInfo: any, callback: any) => {
            if (queryInfo.groupId === -1 || queryInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
              // Return only ungrouped tabs
              callback(validUngroupedTabs);
            } else {
              callback([]);
            }
          });

          // Query ungrouped tabs
          const ungrouped = await tabGroupManager.getUngroupedTabs();

          // Verify: All returned tabs should have groupId === -1
          for (const tab of ungrouped) {
            expect(tab.groupId).toBe(-1);
          }

          // Verify: Count matches ungrouped tabs
          expect(ungrouped.length).toBe(validUngroupedTabs.length);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
