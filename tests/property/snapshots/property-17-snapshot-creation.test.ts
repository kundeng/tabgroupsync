import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SnapshotManager } from '../../../src/lib/bookmarks/snapshotManager';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { StorageManager } from '../../../src/lib/storage/storageManager';

/**
 * Property 17: Snapshot Creation and Storage
 * 
 * For any tab group snapshot creation, the current group state should be saved 
 * with a timestamp in the "Tab Group Snapshots" folder
 * 
 * Validates: Requirements 5.1, 5.3
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

describe('Property 17: Snapshot Creation and Storage', () => {
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

    vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: string) => {
      if (id === 'container-1') {
        return Promise.resolve([
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
      } else if (id === 'snapshots-folder-1') {
        return Promise.resolve(snapshotFolders);
      } else if (id.startsWith('snapshot-folder-')) {
        // Return bookmarks in this snapshot folder
        return Promise.resolve(createdBookmarks.filter(b => b.parentId === id));
      } else {
        return Promise.resolve([]);
      }
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

  it('should create snapshot with timestamp in snapshots folder', async () => {
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

          const beforeTimestamp = Date.now();
          
          // Create snapshot
          const snapshot = await snapshotManager.createSnapshot(
            `group-folder-${group.id}`,
            group.title || 'Test Group',
            'Test snapshot'
          );

          const afterTimestamp = Date.now();

          // Verify: Snapshot metadata should be returned
          expect(snapshot).toBeDefined();
          expect(snapshot.sourceId).toBe(`group-folder-${group.id}`);
          expect(snapshot.sourceName).toBe(group.title || 'Test Group');
          expect(snapshot.timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
          expect(snapshot.timestamp).toBeLessThanOrEqual(afterTimestamp);

          // Verify: Snapshot folder should be created in snapshots folder
          expect(snapshotFolders.length).toBe(1);
          const snapshotFolder = snapshotFolders[0];
          expect(snapshotFolder.parentId).toBe('snapshots-folder-1');
          
          // Verify: Snapshot folder name should contain group name, sourceId, and timestamp
          expect(snapshotFolder.title).toContain(group.title || 'Test Group');
          expect(snapshotFolder.title).toContain(`group-folder-${group.id}`);
          
          // Verify: All tabs should be saved as bookmarks in snapshot folder
          const snapshotBookmarks = createdBookmarks.filter(b => b.parentId === snapshotFolder.id);
          expect(snapshotBookmarks.length).toBe(validTabs.length);
          
          const snapshotUrls = new Set(snapshotBookmarks.map(b => b.url));
          const tabUrls = new Set(validTabs.map(t => t.url));
          
          for (const url of tabUrls) {
            expect(snapshotUrls.has(url)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should store snapshots in Tab Group Snapshots folder', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 5 }), // Number of snapshots to create
        async (group, tabs, snapshotCount) => {
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

          // Create multiple snapshots
          const snapshots = [];
          for (let i = 0; i < snapshotCount; i++) {
            const snapshot = await snapshotManager.createSnapshot(
              `group-folder-${group.id}`,
              group.title || 'Test Group',
              `Snapshot ${i + 1}`
            );
            snapshots.push(snapshot);
            
            // Small delay to ensure different timestamps
            await new Promise(resolve => setTimeout(resolve, 10));
          }

          // Verify: All snapshots should be in the snapshots folder
          expect(snapshotFolders.length).toBe(snapshotCount);
          
          for (const snapshotFolder of snapshotFolders) {
            expect(snapshotFolder.parentId).toBe('snapshots-folder-1');
          }

          // Verify: Each snapshot should have unique timestamp
          const timestamps = snapshots.map(s => s.timestamp);
          const uniqueTimestamps = new Set(timestamps);
          expect(uniqueTimestamps.size).toBe(snapshotCount);

          // Verify: Snapshots should be ordered by timestamp
          for (let i = 1; i < timestamps.length; i++) {
            expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
          }
        }
      ),
      { numRuns: 50 } // Fewer runs due to delays
    );
  }, 60000); // Longer timeout due to delays
});
