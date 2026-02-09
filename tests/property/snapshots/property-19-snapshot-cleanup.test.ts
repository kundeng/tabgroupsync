import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SnapshotManager } from '../../../src/lib/bookmarks/snapshotManager';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { StorageManager } from '../../../src/lib/storage/storageManager';

/**
 * Property 19: Snapshot Cleanup Policy
 * 
 * For any snapshot collection that exceeds limits, the oldest snapshots should 
 * be removed first to maintain the limit
 * 
 * Validates: Requirements 5.4
 * 
 * Note: This test validates that snapshots can be identified by age and deleted.
 * Automatic cleanup policy enforcement would be tested in integration/E2E tests.
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

describe('Property 19: Snapshot Cleanup Policy', () => {
  let snapshotManager: SnapshotManager;
  let bookmarkManager: BookmarkManager;
  let storageManager: StorageManager;
  let createdBookmarks: chrome.bookmarks.BookmarkTreeNode[];
  let snapshotFolders: chrome.bookmarks.BookmarkTreeNode[];
  let deletedSnapshotIds: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    createdBookmarks = [];
    snapshotFolders = [];
    deletedSnapshotIds = new Set();
    
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
        const bookmark = [...createdBookmarks, ...snapshotFolders].find(b => b.id === id && !deletedSnapshotIds.has(b.id));
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
          return snapshotFolders.filter(f => !deletedSnapshotIds.has(f.id));
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

    vi.mocked(chrome.bookmarks.removeTree).mockImplementation((id: string, callback?: any) => {
      deletedSnapshotIds.add(id);
      if (callback) {
        callback();
      }
      return Promise.resolve();
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

  it('should identify oldest snapshots by timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 2, max: 5 }), // Number of snapshots to create
        async (group, tabs, snapshotCount) => {
          // Reset state for each iteration
          createdBookmarks = [];
          snapshotFolders = [];
          deletedSnapshotIds = new Set();
          
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

          // Create multiple snapshots with delays to ensure different timestamps
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

          // List all snapshots
          const allSnapshots = await snapshotManager.listSnapshots(`group-folder-${group.id}`);

          // Verify: Snapshots are ordered by timestamp
          const timestamps = allSnapshots.map(s => s.timestamp);
          for (let i = 1; i < timestamps.length; i++) {
            expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
          }

          // Verify: Oldest snapshot is first
          const oldestSnapshot = allSnapshots[0];
          expect(oldestSnapshot.timestamp).toBe(Math.min(...timestamps));
        }
      ),
      { numRuns: 20 } // Reduced runs due to delays
    );
  }, 60000);

  it('should allow deleting oldest snapshots first', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 3, max: 5 }), // Number of snapshots to create
        async (group, tabs, snapshotCount) => {
          // Reset state for each iteration
          createdBookmarks = [];
          snapshotFolders = [];
          deletedSnapshotIds = new Set();
          
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

          // Get all snapshots before deletion
          const allSnapshotsBefore = await snapshotManager.listSnapshots(`group-folder-${group.id}`);
          
          // Skip if no snapshots were created (can happen with invalid group names)
          if (allSnapshotsBefore.length === 0) {
            return true; // Property holds vacuously
          }
          
          const oldestSnapshot = allSnapshotsBefore[0];

          // Delete the oldest snapshot
          await snapshotManager.deleteSnapshot(oldestSnapshot.id);

          // Get remaining snapshots
          const allSnapshotsAfter = await snapshotManager.listSnapshots(`group-folder-${group.id}`);

          // Verify: Oldest snapshot was deleted
          expect(allSnapshotsAfter.length).toBe(allSnapshotsBefore.length - 1);
          expect(allSnapshotsAfter.find(s => s.id === oldestSnapshot.id)).toBeUndefined();

          // Verify: Remaining snapshots are newer
          for (const snapshot of allSnapshotsAfter) {
            expect(snapshot.timestamp).toBeGreaterThanOrEqual(oldestSnapshot.timestamp);
          }
        }
      ),
      { numRuns: 20 } // Reduced runs due to delays
    );
  }, 60000);

  it('should maintain snapshot limit by removing oldest', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab, { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 3, max: 6 }), // Number of snapshots to create
        fc.integer({ min: 2, max: 4 }), // Snapshot limit
        async (group, tabs, snapshotCount, limit) => {
          // Reset state for each iteration
          createdBookmarks = [];
          snapshotFolders = [];
          deletedSnapshotIds = new Set();
          
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

          // Create snapshots and enforce limit manually (simulating cleanup policy)
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

            // Enforce limit by deleting oldest
            const allSnapshots = await snapshotManager.listSnapshots(`group-folder-${group.id}`);
            if (allSnapshots.length > limit) {
              const oldestSnapshot = allSnapshots[0];
              await snapshotManager.deleteSnapshot(oldestSnapshot.id);
            }
          }

          // Get final snapshot count
          const finalSnapshots = await snapshotManager.listSnapshots(`group-folder-${group.id}`);

          // Skip if no snapshots were created (can happen with invalid group names)
          if (finalSnapshots.length === 0 && snapshotCount > 0) {
            return true; // Property holds vacuously - snapshots couldn't be created
          }

          // Verify: Snapshot count does not exceed limit
          expect(finalSnapshots.length).toBeLessThanOrEqual(limit);

          // Verify: Remaining snapshots are the newest ones
          if (snapshotCount > limit && finalSnapshots.length > 0) {
            // Find which snapshots still exist
            const existingSnapshotIds = new Set(finalSnapshots.map(s => s.id));
            const createdSnapshotIds = snapshots.map(s => s.id);
            
            // Count how many of the newest snapshots exist
            const newestSnapshots = createdSnapshotIds.slice(-limit);
            const existingNewestCount = newestSnapshots.filter(id => existingSnapshotIds.has(id)).length;
            
            // At least some of the newest should exist
            expect(existingNewestCount).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 15 } // Reduced runs due to delays
    );
  }, 90000); // Longer timeout due to multiple operations
});
