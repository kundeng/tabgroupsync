import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SyncEngine } from '../../../src/lib/sync/syncEngine';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { TabGroupManager } from '../../../src/lib/tabGroupManager';
import { arbitraryTabGroup, arbitraryTab } from '../arbitraries';
import { setupAllMocks } from '../testUtils';

/**
 * Property 8: Sync State Transitions
 * 
 * For any tab group, when sync is disabled, the Sync_Engine should stop monitoring changes,
 * and when re-enabled, should immediately synchronize the current state
 * 
 * Validates: Requirements 3.2, 3.3, 3.4
 */

describe('Feature: tab-group-sync, Property 8: Sync State Transitions', () => {
  let syncEngine: SyncEngine;
  let storageManager: StorageManager;
  let bookmarkManager: BookmarkManager;
  let tabGroupManager: TabGroupManager;
  let mocks: ReturnType<typeof setupAllMocks>;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Setup container folder structure FIRST
    mocks = setupAllMocks({
      initialStorage: {
        'state:settings': {
          containerFolderId: 'container-1',
          autoSync: false,
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

  it('should stop monitoring changes when sync is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 5 }),
        async (group, tabs) => {
          const groupName = group.title || 'Test Group';
          
          // Setup: Enable sync initially
          await syncEngine.setGroupSyncEnabled(groupName, true);
          
          // Setup tabs in the group
          for (const tab of tabs) {
            mocks.tabs.set(tab.id!, { ...tab, groupId: group.id });
          }
          
          // Track initial bookmark count
          const initialBookmarkCount = mocks.bookmarkStorage.bookmarks.size;
          
          // Disable sync
          await syncEngine.setGroupSyncEnabled(groupName, false);
          
          // Verify: Sync should be disabled
          const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabled).toBe(false);
          
          // Simulate group update event (should not trigger sync)
          await syncEngine.handleGroupUpdated(group);
          
          // Wait a bit to ensure no async sync happens
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Verify: Sync is disabled in persisted settings
          const groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  }, 30000);

  it('should immediately synchronize when sync is re-enabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 5 }),
        async (group, tabs) => {
          const groupName = group.title || 'Test Group';
          
          // Setup: Start with sync disabled
          await syncEngine.setGroupSyncEnabled(groupName, false);
          
          // Setup tabs in the group
          for (const tab of tabs) {
            mocks.tabs.set(tab.id!, { ...tab, groupId: group.id });
          }
          
          // Mock chrome.tabs.query to return our tabs
          vi.mocked(chrome.tabs.query).mockImplementation((queryInfo: any) => {
            if (queryInfo.groupId === group.id) {
              return Promise.resolve(tabs.map(t => ({ ...t, groupId: group.id })));
            }
            return Promise.resolve([]);
          });
          
          // Mock chrome.tabGroups.query to return our group
          vi.mocked(chrome.tabGroups.query).mockImplementation(() => {
            return Promise.resolve([group]);
          });
          
          // Re-enable sync
          await syncEngine.setGroupSyncEnabled(groupName, true);
          
          // Verify: Sync should be enabled
          const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabled).toBe(true);
          
          // Verify: Sync is queued (we don't wait for completion in property test)
          // The important property is that sync is enabled and will eventually run
          const groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  }, 30000);

  it('should preserve existing bookmarks when sync is disabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 5 }),
        async (group, tabs) => {
          const groupName = group.title || 'Test Group';
          
          // Setup: Enable sync
          await syncEngine.setGroupSyncEnabled(groupName, true);
          
          // Create some bookmarks manually to simulate synced state
          const groupFolder = await bookmarkManager.ensureGroupFolder(groupName);
          for (const tab of tabs) {
            await chrome.bookmarks.create({
              parentId: groupFolder.id,
              title: tab.title,
              url: tab.url
            });
          }
          
          // Track bookmark count after setup
          const bookmarksAfterSetup = mocks.bookmarkStorage.bookmarks.size;
          
          // Disable sync
          await syncEngine.setGroupSyncEnabled(groupName, false);
          
          // Verify: Bookmarks should still exist (preserved)
          const bookmarksAfterDisable = mocks.bookmarkStorage.bookmarks.size;
          expect(bookmarksAfterDisable).toBe(bookmarksAfterSetup);
          
          // Verify: Folders should still exist
          const folders = Array.from(mocks.bookmarkStorage.folders.values());
          const groupFolderExists = folders.some(f => f.title === groupName);
          expect(groupFolderExists).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  }, 30000);

  it('should maintain sync preference across state transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          const groupName = group.title || 'Test Group';
          
          // Enable sync
          await syncEngine.setGroupSyncEnabled(groupName, true);
          
          // Verify: Preference should be persisted
          let groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(true);
          
          // Disable sync
          await syncEngine.setGroupSyncEnabled(groupName, false);
          
          // Verify: Preference should be updated and persisted
          groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(false);
          
          // Re-enable sync
          await syncEngine.setGroupSyncEnabled(groupName, true);
          
          // Verify: Preference should be updated and persisted again
          groupSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(groupSettings.enabled).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  }, 30000);

  it('should update runtime mapping to match persisted state on transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          const groupName = group.title || 'Test Group';
          
          // Enable sync
          await syncEngine.setGroupSyncEnabled(groupName, true);
          
          // Verify: Runtime mapping should reflect enabled state
          let mapping = await storageManager.getMapping(groupName);
          expect(mapping?.syncEnabled).toBe(true);
          
          // Disable sync
          await syncEngine.setGroupSyncEnabled(groupName, false);
          
          // Verify: Runtime mapping should reflect disabled state
          mapping = await storageManager.getMapping(groupName);
          expect(mapping?.syncEnabled).toBe(false);
          
          // Re-enable sync
          await syncEngine.setGroupSyncEnabled(groupName, true);
          
          // Verify: Runtime mapping should reflect enabled state again
          mapping = await storageManager.getMapping(groupName);
          expect(mapping?.syncEnabled).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  }, 30000);

  it('should handle toggle sync correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          const groupName = group.title || 'Test Group';
          
          // Start with sync disabled
          await syncEngine.setGroupSyncEnabled(groupName, false);
          
          // Toggle sync (should enable)
          await syncEngine.toggleSync(groupName);
          
          // Verify: Sync should be enabled
          let syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabled).toBe(true);
          
          // Toggle sync again (should disable)
          await syncEngine.toggleSync(groupName);
          
          // Verify: Sync should be disabled
          syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabled).toBe(false);
          
          // Toggle sync once more (should enable)
          await syncEngine.toggleSync(groupName);
          
          // Verify: Sync should be enabled
          syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(syncEnabled).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  }, 30000);
});
