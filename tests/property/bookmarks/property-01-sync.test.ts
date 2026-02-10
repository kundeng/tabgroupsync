import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { StorageManager } from '../../../src/lib/storage/storageManager';

/**
 * Property 1: Tab Group to Bookmark Folder Synchronization
 * 
 * For any tab group with sync enabled, when tabs are added to the group,
 * the corresponding bookmark folder should contain bookmarks for all those tabs
 * 
 * Validates: Requirements 1.1, 1.2
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

describe('Property 1: Tab Group to Bookmark Folder Synchronization', () => {
  let bookmarkManager: BookmarkManager;
  let storageManager: StorageManager;
  let createdBookmarks: chrome.bookmarks.BookmarkTreeNode[];

  beforeEach(() => {
    vi.clearAllMocks();
    createdBookmarks = [];
    
    // Mock storage manager
    storageManager = new StorageManager();
    
    // Setup container folder
    vi.mocked(chrome.storage.sync.get).mockImplementation((keys: any, callback?: any) => {
      const result = {
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
      };
      if (callback) callback(result);
      return Promise.resolve(result);
    });

    vi.mocked(chrome.storage.sync.set).mockImplementation((items: any, callback?: any) => {
      if (callback) callback();
      return Promise.resolve();
    });

    vi.mocked(chrome.bookmarks.update).mockImplementation((id: string, changes: any, callback?: any) => {
      const result = {
        id,
        title: changes.title || 'Updated',
        parentId: 'bookmarks-folder-1',
        index: 0,
        dateAdded: Date.now(),
      };
      if (callback) callback(result);
      return Promise.resolve(result);
    });

    // Mock bookmark operations
    vi.mocked(chrome.bookmarks.get).mockImplementation((id: string, callback?: any) => {
      let result: chrome.bookmarks.BookmarkTreeNode[] = [];
      if (id === 'container-1') {
        result = [{
          id: 'container-1',
          title: 'Tab Groups',
          parentId: '1',
          index: 0,
          dateAdded: Date.now(),
        }];
      } else if (id === 'bookmarks-folder-1') {
        result = [{
          id: 'bookmarks-folder-1',
          title: 'Tab Group Bookmarks',
          parentId: 'container-1',
          index: 0,
          dateAdded: Date.now(),
        }];
      } else if (id.startsWith('group-folder-')) {
        result = [{
          id,
          title: 'Test Group',
          parentId: 'bookmarks-folder-1',
          index: 0,
          dateAdded: Date.now(),
        }];
      }
      if (callback) callback(result);
      return Promise.resolve(result);
    });

    vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: string, callback?: any) => {
      let result: chrome.bookmarks.BookmarkTreeNode[] = [];
      if (id === 'container-1') {
        result = [
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
        ];
      } else if (id === 'bookmarks-folder-1') {
        result = [];
      } else if (id.startsWith('group-folder-')) {
        // Return previously created bookmarks for this folder
        result = createdBookmarks.filter(b => b.parentId === id);
      }
      if (callback) callback(result);
      return Promise.resolve(result);
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
      
      if (callback) callback(newBookmark);
      return Promise.resolve(newBookmark);
    });

    bookmarkManager = new BookmarkManager(storageManager);
  });

  it('should create bookmarks for all tabs when syncing a group', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 1, maxLength: 20 }),
        async (group, tabs) => {
          // Reset created bookmarks for each iteration
          createdBookmarks = [];
          
          // Initialize storage
          await storageManager.initialize();
          
          // Ensure tabs have valid URLs
          const validTabs = tabs.map(tab => ({
            ...tab,
            url: tab.url || 'https://example.com',
            title: tab.title || 'Untitled',
            groupId: group.id
          }));

          // Sync the group
          const groupFolder = await bookmarkManager.ensureGroupFolder(group.title || 'Test Group');
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            validTabs as chrome.tabs.Tab[],
            groupFolder.id
          );

          // Verify: All tabs should have corresponding bookmarks
          const tabUrls = new Set(validTabs.map(t => t.url));
          const bookmarkUrls = new Set(createdBookmarks.map(b => b.url));

          // Check that all tab URLs are in bookmarks
          for (const url of tabUrls) {
            expect(bookmarkUrls.has(url)).toBe(true);
          }

          // Check that bookmark count matches unique tab URLs
          expect(bookmarkUrls.size).toBe(tabUrls.size);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000); // 30 second timeout for property-based test

  it('should not create duplicate bookmarks when syncing multiple times', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 1, maxLength: 10 }),
        async (group, tabs) => {
          // Reset created bookmarks for each iteration
          createdBookmarks = [];
          
          // Initialize storage
          await storageManager.initialize();
          
          // Ensure tabs have valid URLs
          const validTabs = tabs.map(tab => ({
            ...tab,
            url: tab.url || 'https://example.com',
            title: tab.title || 'Untitled',
            groupId: group.id
          }));

          // Sync the group twice
          const groupFolder = await bookmarkManager.ensureGroupFolder(group.title || 'Test Group');
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            validTabs as chrome.tabs.Tab[],
            groupFolder.id
          );
          
          const bookmarkCountAfterFirstSync = createdBookmarks.length;
          
          await bookmarkManager.syncGroupToFolder(
            group.title || 'Test Group',
            validTabs as chrome.tabs.Tab[],
            groupFolder.id
          );

          // Verify: No new bookmarks should be created on second sync
          expect(createdBookmarks.length).toBe(bookmarkCountAfterFirstSync);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000); // 30 second timeout for property-based test
});
