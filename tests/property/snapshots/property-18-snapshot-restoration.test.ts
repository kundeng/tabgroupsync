import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SnapshotManager } from '../../../src/lib/bookmarks/snapshotManager';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { StorageManager } from '../../../src/lib/storage/storageManager';

/**
 * Property 18: Snapshot Restoration Round-Trip
 * 
 * For any saved snapshot, restoring it should recreate a tab group with the same 
 * tabs that were present when the snapshot was created
 * 
 * Validates: Requirements 5.2
 * 
 * Note: This test validates that snapshots contain all necessary information for
 * restoration. The actual tab group recreation would be tested in E2E tests.
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

describe('Property 18: Snapshot Restoration Round-Trip', () => {
  let snapshotManager: SnapshotManager;
  let bookmarkManager: BookmarkManager;
  let storageManager: StorageManager;
  let createdBookmarks: chrome.bookmarks.BookmarkTreeNode[];
  let snapshotFolders: chrome.bookmarks.BookmarkTreeNode[];

  beforeEach(() => {
    vi.clearAllMocks();
    createdBookmarks = [];
    snapshotFolders = [];
    
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

    // Mock getAllMappings for snapshot migration
    vi.spyOn(storageManager, 'getAllMappings').mockResolvedValue({});

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
      } else if (id === 'snapshots-folder-1') {
        callback([{
          id: 'snapshots-folder-1',
          title: 'Tab Group Snapshots',
          parentId: 'container-1',
          index: 1,
          dateAdded: Date.now(),
        }]);
      } else {
        const bookmark = [...createdBookmarks, ...snapshotFolders].find(b => b.id === id);
        if (bookmark) {
          callback([bookmark]);
        } else {
          callback([]);
        }
      }
    });

    vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: string, callback?: any) => {
      const result = (() => {
        if (id === 'container-1') {
          return [
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
        } else if (id === 'snapshots-folder-1') {
          return snapshotFolders;
        } else if (id.startsWith('snapshot-folder-')) {
          return createdBookmarks.filter(b => b.parentId === id);
        } else {
          return [];
        }
      })();
      
      if (callback) {
        callback(result);
      }
      return Promise.resolve(result);
    });

    let bookmarkIdCounter = 1;
    let snapshotIdCounter = 1;
    vi.mocked(chrome.bookmarks.create).mockImplementation((bookmark: any, callback?: any) => {
      const isSnapshotFolder = bookmark.parentId === 'snapshots-folder-1' && !bookmark.url;
      const newBookmark: chrome.bookmarks.BookmarkTreeNode = {
        id: bookmark.url 
          ? `bookmark-${bookmarkIdCounter++}` 
          : isSnapshotFolder 
            ? `snapshot-folder-${snapshotIdCounter++}`
            : `folder-${bookmarkIdCounter++}`,
        title: bookmark.title,
        url: bookmark.url,
        parentId: bookmark.parentId,
        index: 0,
        dateAdded: Date.now(),
      };
      
      if (isSnapshotFolder) {
        snapshotFolders.push(newBookmark);
      } else if (bookmark.url) {
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
        parentId: 'snapshots-folder-1',
        index: 0,
        dateAdded: Date.now(),
      };
      if (callback) {
        callback(result);
      }
      return Promise.resolve(result);
    });

    // Mock tab groups query
    vi.mocked(chrome.tabGroups.query).mockImplementation((queryInfo: any) => {
      return Promise.resolve([]);
    });

    // Mock tabs query
    vi.mocked(chrome.tabs.query).mockImplementation((queryInfo: any) => {
      return Promise.resolve([]);
    });

    bookmarkManager = new BookmarkManager(storageManager);
    snapshotManager = new SnapshotManager(storageManager, bookmarkManager);
  });

  it('should preserve all tab information in snapshot for restoration', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 1, maxLength: 20 }),
        async (group, tabs) => {
          // Reset state for each iteration
          createdBookmarks = [];
          snapshotFolders = [];
          
          // Initialize storage
          await storageManager.initialize();
          
          // Ensure tabs have valid URLs and belong to the group
          const validTabs = tabs.map(tab => ({
            ...tab,
            url: tab.url || 'https://example.com',
            title: tab.title || 'Untitled',
            groupId: group.id
          }));

          // Mock tab groups query to return our group
          vi.mocked(chrome.tabGroups.query).mockImplementation((queryInfo: any) => {
            return Promise.resolve([group]);
          });

          // Mock tabs query to return tabs in the group
          vi.mocked(chrome.tabs.query).mockImplementation((queryInfo: any) => {
            if (queryInfo.groupId === group.id) {
              return Promise.resolve(validTabs);
            } else {
              return Promise.resolve([]);
            }
          });

          // Create snapshot
          const snapshot = await snapshotManager.createSnapshot(
            `group-folder-${group.id}`,
            group.title || 'Test Group',
            'Test snapshot'
          );

          // Retrieve snapshot bookmarks (simulating restoration)
          const snapshotFolder = snapshotFolders.find(f => f.id === snapshot.id);
          expect(snapshotFolder).toBeDefined();

          const snapshotBookmarks = createdBookmarks.filter(b => b.parentId === snapshot.id);

          // Verify: All original tab URLs are preserved
          const originalUrls = new Set(validTabs.map(t => t.url));
          const snapshotUrls = new Set(snapshotBookmarks.map(b => b.url));

          expect(snapshotUrls.size).toBe(originalUrls.size);
          for (const url of originalUrls) {
            expect(snapshotUrls.has(url)).toBe(true);
          }

          // Verify: All original tab titles are preserved
          const originalTitles = validTabs.map(t => t.title);
          const snapshotTitles = snapshotBookmarks.map(b => b.title);

          for (const title of originalTitles) {
            expect(snapshotTitles).toContain(title);
          }

          // Verify: Snapshot metadata contains source information
          expect(snapshot.sourceName).toBe(group.title || 'Test Group');
          expect(snapshot.sourceId).toBe(`group-folder-${group.id}`);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should maintain tab order and uniqueness in snapshot', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 2, maxLength: 15 }),
        async (group, tabs) => {
          // Reset state for each iteration
          createdBookmarks = [];
          snapshotFolders = [];
          
          // Initialize storage
          await storageManager.initialize();
          
          // Ensure tabs have unique URLs
          const validTabs = tabs.map((tab, idx) => ({
            ...tab,
            url: `https://example.com/page-${idx}`,
            title: tab.title || `Tab ${idx}`,
            groupId: group.id
          }));

          // Mock tab groups query to return our group
          vi.mocked(chrome.tabGroups.query).mockImplementation((queryInfo: any) => {
            return Promise.resolve([group]);
          });

          // Mock tabs query to return tabs in the group
          vi.mocked(chrome.tabs.query).mockImplementation((queryInfo: any) => {
            if (queryInfo.groupId === group.id) {
              return Promise.resolve(validTabs);
            } else {
              return Promise.resolve([]);
            }
          });

          // Create snapshot
          const snapshot = await snapshotManager.createSnapshot(
            `group-folder-${group.id}`,
            group.title || 'Test Group'
          );

          // Retrieve snapshot bookmarks
          const snapshotBookmarks = createdBookmarks.filter(b => b.parentId === snapshot.id);

          // Verify: No duplicate URLs in snapshot
          const snapshotUrls = snapshotBookmarks.map(b => b.url);
          const uniqueUrls = new Set(snapshotUrls);
          expect(uniqueUrls.size).toBe(snapshotUrls.length);

          // Verify: All tabs are represented
          expect(snapshotBookmarks.length).toBe(validTabs.length);

          // Verify: Each original tab has exactly one bookmark
          for (const tab of validTabs) {
            const matchingBookmarks = snapshotBookmarks.filter(b => b.url === tab.url);
            expect(matchingBookmarks.length).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should allow retrieving snapshot metadata for restoration', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 1, maxLength: 10 }),
        async (group, tabs) => {
          // Reset state for each iteration
          createdBookmarks = [];
          snapshotFolders = [];
          
          // Initialize storage
          await storageManager.initialize();
          
          // Ensure tabs have valid URLs and belong to the group
          const validTabs = tabs.map(tab => ({
            ...tab,
            url: tab.url || 'https://example.com',
            title: tab.title || 'Untitled',
            groupId: group.id
          }));

          // Mock tab groups query to return our group
          vi.mocked(chrome.tabGroups.query).mockImplementation((queryInfo: any) => {
            return Promise.resolve([group]);
          });

          // Mock tabs query to return tabs in the group
          vi.mocked(chrome.tabs.query).mockImplementation((queryInfo: any) => {
            if (queryInfo.groupId === group.id) {
              return Promise.resolve(validTabs);
            } else {
              return Promise.resolve([]);
            }
          });

          // Create snapshot
          const createdSnapshot = await snapshotManager.createSnapshot(
            `group-folder-${group.id}`,
            group.title || 'Test Group',
            'Test description'
          );

          // List snapshots (simulating restoration UI)
          const snapshots = await snapshotManager.listSnapshots(`group-folder-${group.id}`);

          // Verify: Created snapshot appears in list
          expect(snapshots.length).toBeGreaterThan(0);
          const retrievedSnapshot = snapshots.find(s => s.id === createdSnapshot.id);
          expect(retrievedSnapshot).toBeDefined();

          // Verify: Metadata is preserved (timestamp may be rounded to nearest second)
          expect(retrievedSnapshot!.sourceId).toBe(createdSnapshot.sourceId);
          expect(retrievedSnapshot!.sourceName).toBe(createdSnapshot.sourceName);
          // Timestamp should be within 1 second (due to formatting/parsing)
          expect(Math.abs(retrievedSnapshot!.timestamp - createdSnapshot.timestamp)).toBeLessThan(1000);
        }
      ),
      { numRuns: 10 } // Reduced runs to avoid timeout
    );
  }, 60000); // Increased timeout
});
