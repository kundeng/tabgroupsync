import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { StorageManager } from '../../../src/lib/storage/storageManager';

/**
 * Property 12: Ungrouped Tab Bookmark Preservation
 * 
 * For any tab that is removed from a group, the Extension should preserve the 
 * existing bookmark but should not continue tracking the now-ungrouped tab
 * 
 * Validates: Requirements 13.2
 */

// Arbitraries for generating test data
const arbitraryUrl = fc.webUrl({ validSchemes: ['http', 'https'] });

const arbitraryTab = fc.record({
  id: fc.integer({ min: 1, max: 10000 }),
  url: arbitraryUrl,
  title: fc.string({ minLength: 1, maxLength: 100 }),
  pinned: fc.boolean(),
  groupId: fc.integer({ min: 1, max: 1000 }),
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

describe('Property 12: Ungrouped Tab Bookmark Preservation', () => {
  let bookmarkManager: BookmarkManager;
  let storageManager: StorageManager;
  let createdBookmarks: chrome.bookmarks.BookmarkTreeNode[];
  let removedBookmarkIds: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    createdBookmarks = [];
    removedBookmarkIds = new Set();
    
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
        const bookmark = createdBookmarks.find(b => b.id === id);
        if (bookmark && !removedBookmarkIds.has(id)) {
          callback([bookmark]);
        } else {
          callback([]);
        }
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
        callback(createdBookmarks.filter(b => b.parentId === id && !removedBookmarkIds.has(b.id)));
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

    vi.mocked(chrome.bookmarks.remove).mockImplementation((id: string, callback?: any) => {
      removedBookmarkIds.add(id);
      if (callback) {
        callback();
      }
      return Promise.resolve();
    });

    bookmarkManager = new BookmarkManager(storageManager);
  });

  it('should preserve bookmarks when tabs are removed from group', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 2, maxLength: 10 }),
        fc.integer({ min: 0, max: 9 }), // Index of tab to remove
        async (group, tabs, removeIndex) => {
          // Reset state for each iteration
          createdBookmarks = [];
          removedBookmarkIds = new Set();
          
          // Initialize storage
          await storageManager.initialize();
          
          // Ensure tabs have valid URLs and belong to the group
          const validTabs = tabs.map(tab => ({
            ...tab,
            url: tab.url || 'https://example.com',
            title: tab.title || 'Untitled',
            groupId: group.id
          }));

          // Sync the group initially
          const groupFolder = await bookmarkManager.ensureGroupFolder(group.title || 'Test Group');
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            validTabs as chrome.tabs.Tab[],
            groupFolder.id
          );

          const initialBookmarkCount = createdBookmarks.length;
          const initialBookmarkUrls = new Set(createdBookmarks.map(b => b.url));

          // Remove a tab from the group (make it ungrouped)
          const tabToRemove = validTabs[removeIndex % validTabs.length];
          const remainingTabs = validTabs.filter((_, idx) => idx !== (removeIndex % validTabs.length));
          
          // Update the removed tab to be ungrouped
          const ungroupedTab = { ...tabToRemove, groupId: -1 };

          // Sync again with only the remaining grouped tabs
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            remainingTabs as chrome.tabs.Tab[],
            groupFolder.id
          );

          // Verify: Bookmarks should be preserved (not deleted)
          // The extension should not automatically delete bookmarks
          const currentBookmarks = createdBookmarks.filter(b => !removedBookmarkIds.has(b.id));
          
          // All original bookmarks should still exist
          for (const url of initialBookmarkUrls) {
            const bookmarkExists = currentBookmarks.some(b => b.url === url);
            expect(bookmarkExists).toBe(true);
          }

          // No bookmarks should have been removed
          expect(removedBookmarkIds.size).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should not track ungrouped tabs in subsequent sync operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 2, maxLength: 10 }),
        fc.integer({ min: 0, max: 9 }), // Index of tab to ungroup
        async (group, tabs, ungroupIndex) => {
          // Reset state for each iteration
          createdBookmarks = [];
          removedBookmarkIds = new Set();
          
          // Initialize storage
          await storageManager.initialize();
          
          // Ensure tabs have valid URLs and belong to the group
          const validTabs = tabs.map(tab => ({
            ...tab,
            url: tab.url || 'https://example.com',
            title: tab.title || 'Untitled',
            groupId: group.id
          }));

          // Sync the group initially
          const groupFolder = await bookmarkManager.ensureGroupFolder(group.title || 'Test Group');
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            validTabs as chrome.tabs.Tab[],
            groupFolder.id
          );

          // Ungroup a tab
          const tabToUngroup = validTabs[ungroupIndex % validTabs.length];
          const ungroupedTab = { ...tabToUngroup, groupId: -1 };
          const remainingGroupedTabs = validTabs.filter((_, idx) => idx !== (ungroupIndex % validTabs.length));

          // Modify the ungrouped tab's URL (simulating user navigation)
          const modifiedUngroupedTab = {
            ...ungroupedTab,
            url: 'https://different-url.com',
            title: 'Different Title'
          };

          // Sync again with only grouped tabs
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            remainingGroupedTabs as chrome.tabs.Tab[],
            groupFolder.id
          );

          // Verify: The modified ungrouped tab's new URL should NOT be in bookmarks
          const bookmarkUrls = new Set(createdBookmarks.map(b => b.url));
          expect(bookmarkUrls.has(modifiedUngroupedTab.url)).toBe(false);

          // Verify: Only grouped tabs should be tracked
          const groupedTabUrls = new Set(remainingGroupedTabs.map(t => t.url));
          for (const url of groupedTabUrls) {
            expect(bookmarkUrls.has(url)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
