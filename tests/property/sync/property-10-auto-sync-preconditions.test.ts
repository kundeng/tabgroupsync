import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SyncEngine } from '../../../src/lib/sync/syncEngine';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { TabGroupManager } from '../../../src/lib/tabGroupManager';
import { arbitraryTabGroup } from '../arbitraries';
import { setupAllMocks } from '../testUtils';

/**
 * Property 10: Auto-Sync Preconditions
 * 
 * For any new tab group, when auto-sync is disabled or no container folder is selected,
 * sync should not be automatically enabled regardless of other settings
 * 
 * Validates: Requirements 6.2, 6.3
 */

describe('Feature: tab-group-sync, Property 10: Auto-Sync Preconditions', () => {
  let syncEngine: SyncEngine;
  let storageManager: StorageManager;
  let bookmarkManager: BookmarkManager;
  let tabGroupManager: TabGroupManager;
  let mocks: ReturnType<typeof setupAllMocks>;

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it('should NOT enable sync when auto-sync is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          // Setup with auto-sync DISABLED but container folder exists
          mocks = setupAllMocks({
            initialStorage: {
              'state:settings': {
                containerFolderId: 'container-1',
                autoSync: false, // Auto-sync disabled
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
          
          // Simulate group creation event
          await syncEngine.handleGroupCreated(group);
          
          // Verify: Sync should NOT be automatically enabled
          const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabled).toBe(false);
          
          // Verify: No sync preference should be persisted (or it should be disabled)
          const groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should NOT enable sync when container folder is not selected', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          // Setup with auto-sync ENABLED but NO container folder
          mocks = setupAllMocks({
            initialStorage: {
              'state:settings': {
                containerFolderId: undefined, // No container folder
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

          storageManager = new StorageManager();
          await storageManager.initialize();
          
          bookmarkManager = new BookmarkManager(storageManager);
          tabGroupManager = new TabGroupManager();
          syncEngine = new SyncEngine(storageManager, bookmarkManager, tabGroupManager);

          const groupName = group.title || 'Test Group';
          
          // Simulate group creation event
          await syncEngine.handleGroupCreated(group);
          
          // Verify: Sync should NOT be automatically enabled
          const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabled).toBe(false);
          
          // Verify: No sync preference should be persisted (or it should be disabled)
          const groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should NOT enable sync when both auto-sync is disabled AND no container folder', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          // Setup with BOTH conditions failing
          mocks = setupAllMocks({
            initialStorage: {
              'state:settings': {
                containerFolderId: undefined, // No container folder
                autoSync: false, // Auto-sync disabled
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

          storageManager = new StorageManager();
          await storageManager.initialize();
          
          bookmarkManager = new BookmarkManager(storageManager);
          tabGroupManager = new TabGroupManager();
          syncEngine = new SyncEngine(storageManager, bookmarkManager, tabGroupManager);

          const groupName = group.title || 'Test Group';
          
          // Simulate group creation event
          await syncEngine.handleGroupCreated(group);
          
          // Verify: Sync should NOT be automatically enabled
          const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabled).toBe(false);
          
          // Verify: No sync preference should be persisted (or it should be disabled)
          const groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should NOT create bookmark folder when auto-sync preconditions fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.boolean(), // auto-sync setting
        fc.boolean(), // has container folder
        async (group, autoSync, hasContainer) => {
          // Skip the case where both conditions are met (that's Property 9)
          if (autoSync && hasContainer) {
            return true;
          }

          // Setup with at least one precondition failing
          mocks = setupAllMocks({
            initialStorage: {
              'state:settings': {
                containerFolderId: hasContainer ? 'container-1' : undefined,
                autoSync: autoSync,
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

          if (hasContainer) {
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
          }

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
          
          // Verify: No new folder should be created for the group
          const finalFolderCount = mocks.bookmarkStorage.folders.size;
          
          // The folder count should either stay the same or only increase by system folders
          // but NOT by a group-specific folder
          const folders = Array.from(mocks.bookmarkStorage.folders.values());
          const groupFolderExists = folders.some(f => f.title === groupName);
          expect(groupFolderExists).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should NOT persist sync preference when preconditions fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryTabGroup, { minLength: 2, maxLength: 5 }),
        async (groups) => {
          // Setup with auto-sync disabled
          mocks = setupAllMocks({
            initialStorage: {
              'state:settings': {
                containerFolderId: 'container-1',
                autoSync: false, // Auto-sync disabled
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
          for (const group of groups) {
            const groupName = group.title || 'Test Group';
            
            // Simulate group creation
            await syncEngine.handleGroupCreated(group);
            
            // Verify: Sync should NOT be enabled
            const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
            expect(syncEnabled).toBe(false);
            
            // Verify: Persisted settings should show disabled
            const groupSettings = await storageManager.getGroupSyncSettings(groupName);
            expect(groupSettings.enabled).toBe(false);
          }
        }
      ),
      { numRuns: 50 }
    );
  }, 30000);

  it('should maintain disabled state after group creation when preconditions fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          // Setup with no container folder
          mocks = setupAllMocks({
            initialStorage: {
              'state:settings': {
                containerFolderId: undefined, // No container folder
                autoSync: true, // Auto-sync enabled but should not activate
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

          storageManager = new StorageManager();
          await storageManager.initialize();
          
          bookmarkManager = new BookmarkManager(storageManager);
          tabGroupManager = new TabGroupManager();
          syncEngine = new SyncEngine(storageManager, bookmarkManager, tabGroupManager);

          const groupName = group.title || 'Test Group';
          
          // Simulate group creation
          await syncEngine.handleGroupCreated(group);
          
          // Verify: Sync is disabled immediately after creation
          const syncEnabledAfterCreation = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabledAfterCreation).toBe(false);
          
          // Wait a bit to ensure state is stable
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Verify: Sync is still disabled after waiting
          const syncEnabledAfterWait = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabledAfterWait).toBe(false);
          
          // Verify: Persisted settings still show disabled
          const groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should NOT update lastSynced timestamp when preconditions fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          // Setup with auto-sync disabled
          mocks = setupAllMocks({
            initialStorage: {
              'state:settings': {
                containerFolderId: 'container-1',
                autoSync: false, // Auto-sync disabled
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
          
          // Simulate group creation
          await syncEngine.handleGroupCreated(group);
          
          // Verify: lastSynced should be 0 (never synced)
          const groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.lastSynced).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
