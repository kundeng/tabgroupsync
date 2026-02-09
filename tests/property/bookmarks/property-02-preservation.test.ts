import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { StorageManager } from '../../../src/lib/storage/storageManager';

/**
 * Property 2: Bookmark Preservation During Tab Operations
 * 
 * For any synced tab group, when tabs are removed from the group,
 * the existing bookmarks in the corresponding folder should remain unchanged
 * (no automatic deletion)
 * 
 * Validates: Requirements 1.3
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

describe('Property 2: Bookmark Preservation During Tab Operations', () => {
  let bookmarkManager: BookmarkManager;
  let storageManager: StorageManager;
  let createdBookmarks: chrome.bookmarks.BookmarkTreeNode[];
  let removedBookmarks: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    createdBookmarks = [];
    removedBookmarks = [];
    
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
      } else if (id.startsWith('group-folder-')) {
        callback([{
          id,
          title: 'Test Group',
          parentId: 'bookmarks-folder-1',
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
          },
          {
            id: 'snapshots-folder-1',
            title: 'Tab Group Snapshots',
            parentId: 'container-1',
            index: 1,
            dateAdded: Date.now(),
          }
        ]);
      } else if (id === 'bookmarks-folder-1') {
        callback([]);
      } else if (id.startsWith('group-folder-')) {
        // Return bookmarks that haven't been removed
        callback(createdBookmarks.filter(b => b.parentId === id && !removedBookmarks.includes(b.id)));
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

    // Track bookmark removals (should not be called in this property test)
    vi.mocked(chrome.bookmarks.remove).mockImplementation((id: string, callback?: any) => {
      removedBookmarks.push(id);
      if (callback) callback();
      return Promise.resolve();
    });

    bookmarkManager = new BookmarkManager(storageManager);
  });

  it('should preserve bookmarks when tabs are removed from group', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 2, maxLength: 20 }),
        async (group, tabs) => {
          // Reset state for each iteration
          createdBookmarks = [];
          removedBookmarks = [];
          
          // Initialize storage
          await storageManager.initialize();
          
          // Ensure tabs have valid URLs
          const validTabs = tabs.map(tab => ({
            ...tab,
            url: tab.url || 'https://example.com',
            title: tab.title || 'Untitled',
            groupId: group.id
          }));

          // Sync the group with all tabs
          const groupFolder = await bookmarkManager.ensureGroupFolder(group.title || 'Test Group');
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            validTabs as chrome.tabs.Tab[],
            groupFolder.id
          );

          const bookmarkCountAfterFirstSync = createdBookmarks.length;

          // Remove some tabs from the group (simulate tab removal)
          const remainingTabs = validTabs.slice(0, Math.floor(validTabs.length / 2));
          
          // Sync again with fewer tabs
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            remainingTabs as chrome.tabs.Tab[],
            groupFolder.id
          );

          // Verify: No bookmarks should be removed
          expect(removedBookmarks.length).toBe(0);
          
          // Verify: Original bookmarks still exist
          expect(createdBookmarks.length).toBe(bookmarkCountAfterFirstSync);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000); // 30 second timeout for property-based test

  it('should not delete bookmarks when all tabs are removed from group', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 1, maxLength: 10 }),
        async (group, tabs) => {
          // Reset state for each iteration
          createdBookmarks = [];
          removedBookmarks = [];
          
          // Initialize storage
          await storageManager.initialize();
          
          // Ensure tabs have valid URLs
          const validTabs = tabs.map(tab => ({
            ...tab,
            url: tab.url || 'https://example.com',
            title: tab.title || 'Untitled',
            groupId: group.id
          }));

          // Sync the group with all tabs
          const groupFolder = await bookmarkManager.ensureGroupFolder(group.title || 'Test Group');
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            validTabs as chrome.tabs.Tab[],
            groupFolder.id
          );

          const bookmarkCountAfterFirstSync = createdBookmarks.length;

          // Remove all tabs from the group
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            [] as chrome.tabs.Tab[],
            groupFolder.id
          );

          // Verify: No bookmarks should be removed
          expect(removedBookmarks.length).toBe(0);
          
          // Verify: All original bookmarks still exist
          expect(createdBookmarks.length).toBe(bookmarkCountAfterFirstSync);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000); // 30 second timeout for property-based test
});
