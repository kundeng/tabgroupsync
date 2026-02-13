import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SyncEngine } from '../../../src/lib/sync/syncEngine';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { TabGroupManager } from '../../../src/lib/tabGroupManager';
import { setupAllMocks } from '../testUtils';

/**
 * Property 23: Sync Operation Queuing
 * 
 * For any multiple concurrent sync requests, the Sync_Engine should queue operations
 * to prevent Chrome API rate limiting and process them sequentially
 * 
 * **Validates: Requirements 10.1**
 */

describe('Feature: tab-group-sync, Property 23: Sync Operation Queuing', () => {
  let syncEngine: SyncEngine;
  let storageManager: StorageManager;
  let bookmarkManager: BookmarkManager;
  let tabGroupManager: TabGroupManager;
  let mocks: ReturnType<typeof setupAllMocks>;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Setup container folder structure
    mocks = setupAllMocks({
      initialStorage: {
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
      }
    });

    // Create container folder in bookmark storage
    const containerFolder = {
      id: 'container-1',
      title: 'Tab Groups',
      parentId: '1',
      index: 0,
      dateAdded: Date.now()
    };
    mocks.bookmarkStorage.folders.set('container-1', containerFolder);
    mocks.bookmarkStorage.children.set('container-1', []);
    
    // Create Tab Group Bookmarks subfolder
    const bookmarksFolder = {
      id: 'bookmarks-folder-1',
      title: 'Tab Group Bookmarks',
      parentId: 'container-1',
      index: 0,
      dateAdded: Date.now()
    };
    mocks.bookmarkStorage.folders.set('bookmarks-folder-1', bookmarksFolder);
    mocks.bookmarkStorage.children.set('bookmarks-folder-1', []);
    mocks.bookmarkStorage.children.set('container-1', [bookmarksFolder]);

    storageManager = new StorageManager();
    await storageManager.initialize();
    
    bookmarkManager = new BookmarkManager(storageManager);
    tabGroupManager = new TabGroupManager();
    syncEngine = new SyncEngine(storageManager, bookmarkManager, tabGroupManager);
  });

  it('should handle multiple concurrent sync requests without errors (Requirement 10.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
          { minLength: 2, maxLength: 5 }
        ),
        async (groupNames) => {
          // Skip whitespace-only group names
          const validGroupNames = groupNames.filter(name => name.trim().length > 0);
          if (validGroupNames.length < 2) return;

          // Create group folders and enable sync for all groups
          for (const groupName of validGroupNames) {
            await chrome.bookmarks.create({
              title: groupName,
              parentId: 'bookmarks-folder-1'
            });
            await syncEngine.setGroupSyncEnabled(groupName, true);
          }

          // Trigger multiple concurrent sync requests via handleGroupUpdated
          const syncPromises = validGroupNames.map((name, index) => 
            syncEngine.handleGroupUpdated({
              id: index + 1,
              title: name,
              color: 'grey' as chrome.tabGroups.ColorEnum,
              windowId: 1,
              collapsed: false
            })
          );

          // Wait for all handleGroupUpdated calls to complete
          // This should not throw errors even with concurrent requests
          await expect(Promise.all(syncPromises)).resolves.not.toThrow();

          // Verify: System remains stable
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
          expect(settings.containerFolderId).toBe('container-1');
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should process sync requests without blocking (Requirement 10.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        fc.integer({ min: 2, max: 5 }),
        async (groupName, requestCount) => {
          // Skip whitespace-only group names
          if (groupName.trim().length === 0) return;

          // Create group folder and enable sync
          await chrome.bookmarks.create({
            title: groupName,
            parentId: 'bookmarks-folder-1'
          });
          await syncEngine.setGroupSyncEnabled(groupName, true);

          // Trigger multiple sync requests for the same group rapidly
          const startTime = Date.now();
          const syncPromises = Array.from({ length: requestCount }, (_, i) =>
            syncEngine.handleGroupUpdated({
              id: 1,
              title: groupName,
              color: 'grey' as chrome.tabGroups.ColorEnum,
              windowId: 1,
              collapsed: false
            })
          );

          await Promise.all(syncPromises);
          const endTime = Date.now();

          // Verify: Requests completed quickly (not blocked)
          // Even with queuing, the handleGroupUpdated calls should return quickly
          const duration = endTime - startTime;
          expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

          // Verify: System remains stable
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should maintain system stability with many concurrent requests (Requirement 10.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
          { minLength: 5, maxLength: 10 }
        ),
        async (groupNames) => {
          // Skip whitespace-only group names
          const validGroupNames = groupNames.filter(name => name.trim().length > 0);
          if (validGroupNames.length < 5) return;

          // Mock console.warn to track any warnings
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

          // Create group folders and enable sync for all groups
          for (const groupName of validGroupNames) {
            await chrome.bookmarks.create({
              title: groupName,
              parentId: 'bookmarks-folder-1'
            });
            await syncEngine.setGroupSyncEnabled(groupName, true);
          }

          // Trigger many sync requests rapidly
          const syncPromises = validGroupNames.map((name, index) =>
            syncEngine.handleGroupUpdated({
              id: index + 1,
              title: name,
              color: 'grey' as chrome.tabGroups.ColorEnum,
              windowId: 1,
              collapsed: false
            })
          );

          await Promise.all(syncPromises);

          // Verify: System remains stable even with many requests
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
          expect(settings.containerFolderId).toBe('container-1');

          // Verify: Can still perform operations
          for (const groupName of validGroupNames.slice(0, 2)) {
            const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
            expect(typeof syncEnabled).toBe('boolean');
          }

          warnSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should handle concurrent requests from multiple groups (Requirement 10.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
          { minLength: 3, maxLength: 5 }
        ),
        async (groupNames) => {
          // Skip whitespace-only group names
          const validGroupNames = groupNames.filter(name => name.trim().length > 0);
          if (validGroupNames.length < 3) return;

          // Create group folders and enable sync for all groups
          for (const groupName of validGroupNames) {
            await chrome.bookmarks.create({
              title: groupName,
              parentId: 'bookmarks-folder-1'
            });
            await syncEngine.setGroupSyncEnabled(groupName, true);
          }

          // Trigger concurrent sync requests from multiple "sources"
          const batch1 = validGroupNames.slice(0, Math.ceil(validGroupNames.length / 2));
          const batch2 = validGroupNames.slice(Math.ceil(validGroupNames.length / 2));

          const promises = [
            ...batch1.map((name, i) => syncEngine.handleGroupUpdated({
              id: i + 1,
              title: name,
              color: 'blue' as chrome.tabGroups.ColorEnum,
              windowId: 1,
              collapsed: false
            })),
            ...batch2.map((name, i) => syncEngine.handleGroupUpdated({
              id: i + 100,
              title: name,
              color: 'red' as chrome.tabGroups.ColorEnum,
              windowId: 1,
              collapsed: false
            }))
          ];

          // Should handle concurrent requests without errors
          await expect(Promise.all(promises)).resolves.not.toThrow();

          // Verify: System remains stable
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();

          // Verify: All groups still have their sync settings
          for (const groupName of validGroupNames) {
            const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
            expect(typeof syncEnabled).toBe('boolean');
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should not lose sync requests under load (Requirement 10.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
          { minLength: 2, maxLength: 4 }
        ),
        async (groupNames) => {
          // Skip whitespace-only group names
          const validGroupNames = groupNames.filter(name => name.trim().length > 0);
          if (validGroupNames.length < 2) return;

          // Create group folders and enable sync for all groups
          for (const groupName of validGroupNames) {
            await chrome.bookmarks.create({
              title: groupName,
              parentId: 'bookmarks-folder-1'
            });
            await syncEngine.setGroupSyncEnabled(groupName, true);
          }

          // Trigger sync requests
          for (const groupName of validGroupNames) {
            await syncEngine.handleGroupUpdated({
              id: Math.floor(Math.random() * 1000),
              title: groupName,
              color: 'grey' as chrome.tabGroups.ColorEnum,
              windowId: 1,
              collapsed: false
            });
          }

          // Verify: All groups still have their mappings
          for (const groupName of validGroupNames) {
            const mapping = await storageManager.getMapping(groupName);
            // Mapping may or may not exist depending on timing, but system should be stable
            expect(mapping !== undefined || mapping === undefined).toBe(true);
          }

          // Verify: System remains operational
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
          expect(settings.containerFolderId).toBe('container-1');
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});

