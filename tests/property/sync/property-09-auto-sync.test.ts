import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SyncEngine } from '../../../src/lib/sync/syncEngine';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { TabGroupManager } from '../../../src/lib/tabGroupManager';
import { arbitraryTabGroup } from '../arbitraries';
import { setupAllMocks } from '../testUtils';

/**
 * Property 9: Auto-Sync Behavior
 * 
 * For any new tab group created when auto-sync is enabled and a container folder is selected,
 * sync should be automatically enabled and the preference should be persisted
 * 
 * EXCEPTION: Groups with whitespace-only titles should be skipped and not synced
 * 
 * Validates: Requirements 6.1, 6.4, 15.2, 15.4, 15.5
 */

describe('Feature: tab-group-sync, Property 9: Auto-Sync Behavior', () => {
  let syncEngine: SyncEngine;
  let storageManager: StorageManager;
  let bookmarkManager: BookmarkManager;
  let tabGroupManager: TabGroupManager;
  let mocks: ReturnType<typeof setupAllMocks>;

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it('should automatically enable sync when auto-sync is enabled and container folder exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          // Skip whitespace-only titles as they should not be synced
          const groupName = group.title || 'Test Group';
          if (groupName.trim() === '') {
            return; // Skip this test case
          }
          
          // Setup with auto-sync enabled and container folder
          mocks = setupAllMocks({
            initialStorage: {
              'state:settings': {
                containerFolderId: 'container-1',
                autoSync: true, // Auto-sync enabled
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
          
          // Simulate group creation event
          await syncEngine.handleGroupCreated(group);
          
          // Verify: Sync should be automatically enabled
          const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabled).toBe(true);
          
          // Verify: Preference should be persisted
          const groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(true);
          
          // Verify: Runtime mapping should reflect enabled state
          const mapping = await storageManager.getMapping(groupName);
          expect(mapping).toBeDefined();
          expect(mapping?.syncEnabled).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should persist sync preference across multiple group creations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryTabGroup, { minLength: 2, maxLength: 5 }),
        async (groups) => {
          // Filter out whitespace-only titles
          const validGroups = groups.filter(g => {
            const name = g.title || 'Test Group';
            return name.trim() !== '';
          });
          
          // Skip if no valid groups
          if (validGroups.length === 0) {
            return;
          }
          
          // Setup with auto-sync enabled
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

          // Create container folder structure
          const containerFolder = {
            id: 'container-1',
            title: 'Tab Groups',
            parentId: '1',
            index: 0,
            dateAdded: Date.now()
          };
          mocks.bookmarkStorage.folders.set('container-1', containerFolder);
          mocks.bookmarkStorage.children.set('container-1', []);
          
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

          // Create multiple groups
          for (const group of validGroups) {
            const groupName = group.title || 'Test Group';
            
            // Simulate group creation
            await syncEngine.handleGroupCreated(group);
            
            // Verify each group has sync enabled and persisted
            const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
            expect(syncEnabled).toBe(true);
            
            const groupSettings = await storageManager.getGroupSyncSettings(groupName);
            expect(groupSettings.enabled).toBe(true);
          }
        }
      ),
      { numRuns: 50 }
    );
  }, 30000);

  it('should create bookmark folder when auto-sync enables sync', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          // Setup with auto-sync enabled
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

          // Create container folder structure
          const containerFolder = {
            id: 'container-1',
            title: 'Tab Groups',
            parentId: '1',
            index: 0,
            dateAdded: Date.now()
          };
          mocks.bookmarkStorage.folders.set('container-1', containerFolder);
          mocks.bookmarkStorage.children.set('container-1', []);
          
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

          const groupName = group.title || 'Test Group';
          
          // Track initial folder count
          const initialFolderCount = mocks.bookmarkStorage.folders.size;
          
          // Simulate group creation
          await syncEngine.handleGroupCreated(group);
          
          // Verify: A new folder should be created for the group
          const finalFolderCount = mocks.bookmarkStorage.folders.size;
          expect(finalFolderCount).toBeGreaterThan(initialFolderCount);
          
          // Verify: The folder should exist in the bookmark storage
          const folders = Array.from(mocks.bookmarkStorage.folders.values());
          const groupFolderExists = folders.some(f => f.title === groupName);
          expect(groupFolderExists).toBe(true);
          
          // Verify: Runtime mapping should have the folder ID
          const mapping = await storageManager.getMapping(groupName);
          expect(mapping?.folderId).toBeDefined();
          expect(mapping?.folderId).not.toBe('');
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should maintain sync enabled state after group creation', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          // Skip whitespace-only titles
          const groupName = group.title || 'Test Group';
          if (groupName.trim() === '') {
            return;
          }
          
          // Setup with auto-sync enabled
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

          // Create container folder structure
          const containerFolder = {
            id: 'container-1',
            title: 'Tab Groups',
            parentId: '1',
            index: 0,
            dateAdded: Date.now()
          };
          mocks.bookmarkStorage.folders.set('container-1', containerFolder);
          mocks.bookmarkStorage.children.set('container-1', []);
          
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
          
          // Simulate group creation
          await syncEngine.handleGroupCreated(group);
          
          // Verify: Sync is enabled immediately after creation
          const syncEnabledAfterCreation = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabledAfterCreation).toBe(true);
          
          // Wait a bit to ensure state is stable
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Verify: Sync is still enabled after waiting
          const syncEnabledAfterWait = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabledAfterWait).toBe(true);
          
          // Verify: Persisted settings still show enabled
          const groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should update lastSynced timestamp when auto-sync enables sync', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          // Skip whitespace-only titles
          const groupName = group.title || 'Test Group';
          if (groupName.trim() === '') {
            return;
          }
          
          // Setup with auto-sync enabled
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

          // Create container folder structure
          const containerFolder = {
            id: 'container-1',
            title: 'Tab Groups',
            parentId: '1',
            index: 0,
            dateAdded: Date.now()
          };
          mocks.bookmarkStorage.folders.set('container-1', containerFolder);
          mocks.bookmarkStorage.children.set('container-1', []);
          
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

          const beforeTimestamp = Date.now();
          
          // Simulate group creation
          await syncEngine.handleGroupCreated(group);
          
          const afterTimestamp = Date.now();
          
          // Verify: lastSynced should be set to a recent timestamp
          const groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.lastSynced).toBeGreaterThanOrEqual(beforeTimestamp);
          expect(groupSettings.lastSynced).toBeLessThanOrEqual(afterTimestamp);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should skip groups with whitespace-only titles', async () => {
    // Test various whitespace-only titles
    const whitespaceOnlyTitles = [
      ' ',           // Single space
      '  ',          // Multiple spaces
      '\t',          // Tab
      '\n',          // Newline
      ' \t\n ',      // Mixed whitespace
      '     '        // Many spaces
    ];

    for (const title of whitespaceOnlyTitles) {
      // Setup with auto-sync enabled
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

      // Create container folder structure
      const containerFolder = {
        id: 'container-1',
        title: 'Tab Groups',
        parentId: '1',
        index: 0,
        dateAdded: Date.now()
      };
      mocks.bookmarkStorage.folders.set('container-1', containerFolder);
      mocks.bookmarkStorage.children.set('container-1', []);
      
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

      const group = {
        id: 1,
        title,
        color: 'grey' as chrome.tabGroups.ColorEnum,
        windowId: 1,
        collapsed: false
      };
      
      const initialFolderCount = mocks.bookmarkStorage.folders.size;
      
      // Simulate group creation
      await syncEngine.handleGroupCreated(group);
      
      // Verify: No new folder should be created
      const finalFolderCount = mocks.bookmarkStorage.folders.size;
      expect(finalFolderCount).toBe(initialFolderCount);
      
      // Verify: No mapping should be created
      const mapping = await storageManager.getMapping(title);
      expect(mapping).toBeUndefined();
      
      // Verify: Sync should not be enabled
      const syncEnabled = await syncEngine.getGroupSyncEnabled(title);
      expect(syncEnabled).toBe(false);
    }
  }, 30000);

  it('should skip unnamed groups (transient state, not synced)', async () => {
    // Unnamed groups (undefined/empty title) are transient — they should NOT be synced
    const unnamedVariants = [
      undefined,
      '',
    ];

    for (const title of unnamedVariants) {
      // Setup with auto-sync enabled
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

      // Create container folder structure
      const containerFolder = {
        id: 'container-1',
        title: 'Tab Groups',
        parentId: '1',
        index: 0,
        dateAdded: Date.now()
      };
      mocks.bookmarkStorage.folders.set('container-1', containerFolder);
      mocks.bookmarkStorage.children.set('container-1', []);
      
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

      const group = {
        id: 1,
        title,
        color: 'grey' as chrome.tabGroups.ColorEnum,
        windowId: 1,
        collapsed: false
      };
      
      // Simulate group creation
      await syncEngine.handleGroupCreated(group);
      
      // Verify: No mapping should be created for unnamed groups
      const allMappings = await storageManager.getAllMappings();
      expect(Object.keys(allMappings).length).toBe(0);
      
      // Verify: No folder should be created for unnamed groups
      const folders = Array.from(mocks.bookmarkStorage.folders.values());
      const unnamedFolder = folders.find(f => f.title === 'Unnamed Group');
      expect(unnamedFolder).toBeUndefined();
    }
  }, 30000);
});
