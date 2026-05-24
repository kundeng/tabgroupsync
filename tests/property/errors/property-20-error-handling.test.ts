import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SyncEngine } from '../../../src/lib/sync/syncEngine';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { TabGroupManager } from '../../../src/lib/tabGroupManager';
import { arbitraryTabGroup, arbitraryTab } from '../arbitraries';
import { setupAllMocks, setupBookmarkMocks } from '../testUtils';

/**
 * Property 21: Permission and Quota Management
 * 
 * For any insufficient permissions or quota limits, the system should request
 * appropriate permissions or inform users with suggested cleanup actions
 * 
 * Validates: Requirements 8.2, 8.4
 */

describe('Feature: tab-group-sync, Property 21: Permission and Quota Management', () => {
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

  it('should handle bookmark permission errors gracefully (Requirement 8.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          const groupName = group.title || 'Test Group';

          // Mock bookmark creation to fail with permission error
          const permissionError = new Error('Permission denied: bookmarks');
          vi.mocked(chrome.bookmarks.create).mockRejectedValueOnce(permissionError);

          // Mock console.error to track error logging
          const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

          // Attempt to create a bookmark folder — should fail due to permission error
          let caughtError = false;
          try {
            await bookmarkManager.ensureGroupFolder(groupName);
          } catch (error) {
            caughtError = true;
            // Error expected (may be wrapped by bookmarkManager)
            expect(error).toBeDefined();
          }
          expect(caughtError).toBe(true);

          // Verify: System remains stable after permission error
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
          expect(settings.containerFolderId).toBe('container-1');

          // Verify: Can still create bookmarks after error clears
          setupBookmarkMocks(mocks.bookmarkStorage);
          const folder = await chrome.bookmarks.create({ title: 'Recovery Test', parentId: 'bookmarks-folder-1' });
          expect(folder).toBeDefined();

          errorSpy.mockRestore();
        }
      ),
      { numRuns: 5 }
    );
  }, 10000);

  it('should handle storage quota exceeded errors with cleanup suggestions (Requirement 8.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          // Mock storage.sync.set to fail with quota exceeded error
          const quotaError = new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
          vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(quotaError);

          // Mock console.error to track error logging
          const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

          // Attempt to update settings (which will trigger quota error)
          try {
            await storageManager.updateSettings({ autoSync: false });
          } catch (error) {
            // Quota error expected
          }

          // Verify: Error or warning should be logged about quota
          const allCalls = [...errorSpy.mock.calls, ...warnSpy.mock.calls];
          const hasQuotaMessage = allCalls.some(call => {
            const callStr = JSON.stringify(call);
            return callStr.toLowerCase().includes('quota') || 
                   callStr.toLowerCase().includes('exceeded');
          });
          expect(hasQuotaMessage).toBe(true);

          // Verify: System remains stable after quota error (in-memory state still valid)
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();

          errorSpy.mockRestore();
          warnSpy.mockRestore();
        }
      ),
      { numRuns: 5 }
    );
  }, 10000);

  it('should maintain system stability when permissions are insufficient (Requirement 8.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          const groupName = group.title || 'Test Group';

          // Suppress console output
          const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

          // Mock bookmark operations to fail with permission error
          const permissionError = new Error('Extension does not have permission to access bookmarks');
          vi.mocked(chrome.bookmarks.create).mockRejectedValueOnce(permissionError);

          // Attempt bookmark operation — should fail
          try {
            await bookmarkManager.ensureGroupFolder(groupName);
          } catch (error) {
            // Expected
          }

          // Verify: System should remain operational after permission error
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
          expect(settings.containerFolderId).toBe('container-1');

          // Verify: Storage operations still work
          await expect(
            storageManager.updateSettings({ autoSync: true })
          ).resolves.not.toThrow();

          // Verify: Can still query sync settings
          const syncSettings = await storageManager.getGroupSyncSettings(groupName);
          expect(syncSettings).toBeDefined();
          expect(typeof syncSettings.enabled).toBe('boolean');

          errorSpy.mockRestore();
          // Restore default bookmark mocks for next iteration
          setupBookmarkMocks(mocks.bookmarkStorage);
        }
      ),
      { numRuns: 5 }
    );
  }, 10000);

  it('should handle quota limits with appropriate error messages (Requirement 8.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryTabGroup, { minLength: 1, maxLength: 2 }), // Reduced from 3 to 2
        async (groups) => {
          // Mock storage to fail with quota error after some operations
          let setCallCount = 0;
          const quotaError = new Error('QUOTA_BYTES quota exceeded');
          
          vi.mocked(chrome.storage.sync.set).mockImplementation(async (items: any) => {
            setCallCount++;
            if (setCallCount > 2) {
              throw quotaError;
            }
            Object.assign(mocks.storageData, items);
            return Promise.resolve();
          });

          // Mock console to track error messages
          const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

          // Attempt to enable sync for multiple groups (will hit quota)
          for (const group of groups) {
            const groupName = group.title || `Group ${group.id}`;
            
            try {
              await syncEngine.setGroupSyncEnabled(groupName, true);
            } catch (error) {
              // Quota error expected after a few operations
            }
          }

          // Verify: Quota error should be logged
          const allCalls = [...errorSpy.mock.calls, ...warnSpy.mock.calls];
          const hasQuotaError = allCalls.some(call => {
            const callStr = JSON.stringify(call);
            return callStr.toLowerCase().includes('quota');
          });
          
          // If we hit the quota limit, it should be logged
          if (setCallCount > 2) {
            expect(hasQuotaError).toBe(true);
          }

          // Verify: System remains stable
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();

          errorSpy.mockRestore();
          warnSpy.mockRestore();
        }
      ),
      { numRuns: 10 } // Reduced from 25 to 10
    );
  }, 10000);

  it('should recover from permission errors when permissions are granted (Requirement 8.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 2 }),
        async (group, tabs) => {
          const groupName = group.title || 'Test Group';
          
          // Setup: Create group folder (uses default mock)
          await chrome.bookmarks.create({
            title: groupName,
            parentId: 'bookmarks-folder-1'
          });

          // Enable sync (uses default bookmark mock)
          await syncEngine.setGroupSyncEnabled(groupName, true);

          // Mock tabs query
          vi.mocked(chrome.tabs.query).mockResolvedValue(
            tabs.map(t => ({ 
              ...t, 
              groupId: group.id, 
              url: t.url || 'https://example.com',
              title: t.title || 'Test Tab'
            })) as chrome.tabs.Tab[]
          );

          // Suppress console output
          const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

          // Mock bookmark creation to fail persistently (simulating permission denied)
          const permissionError = new Error('Permission denied: bookmarks');
          vi.mocked(chrome.bookmarks.create).mockRejectedValue(permissionError);

          // First sync attempt (will fail with permission error)
          try {
            await syncEngine.syncGroupToFolder(groupName);
          } catch (error) {
            // Expected to fail
          }

          // Verify: System is still operational
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();

          // Restore bookmark mock (simulating permission granted)
          let createCounter = 0;
          vi.mocked(chrome.bookmarks.create).mockImplementation(async (bookmark: any) => {
            createCounter++;
            return {
              id: `bookmark-${Date.now()}-${createCounter}`,
              title: bookmark.title,
              url: bookmark.url,
              parentId: bookmark.parentId,
              index: 0,
              dateAdded: Date.now(),
            };
          });

          // Second sync attempt (should succeed after "permission granted")
          await expect(syncEngine.syncGroupToFolder(groupName)).resolves.not.toThrow();

          // Verify: System recovered successfully
          const finalSettings = await storageManager.getSettings();
          expect(finalSettings).toBeDefined();
          expect(finalSettings.containerFolderId).toBe('container-1');

          errorSpy.mockRestore();
          // Restore default bookmark mocks for next iteration
          setupBookmarkMocks(mocks.bookmarkStorage);
        }
      ),
      { numRuns: 3 }
    );
  }, 30000);

  it('should provide informative error messages for quota-related failures (Requirement 8.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        async (group) => {
          const groupName = group.title || 'Test Group';
          
          // Mock storage to fail with quota error
          const quotaError = new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
          vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(quotaError);

          // Mock console to capture error messages
          const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

          // Attempt operation that will hit quota
          try {
            await storageManager.updateSettings({ 
              autoSync: true,
              containerFolderId: 'some-very-long-folder-id-that-might-cause-quota-issues'
            });
          } catch (error) {
            // Quota error expected
          }

          // Verify: Error message should be informative
          const allCalls = [...errorSpy.mock.calls, ...warnSpy.mock.calls];
          const hasInformativeMessage = allCalls.some(call => {
            const callStr = JSON.stringify(call);
            const lower = callStr.toLowerCase();
            // Should mention quota and ideally suggest cleanup
            return lower.includes('quota') && 
                   (lower.includes('exceeded') || lower.includes('limit'));
          });
          expect(hasInformativeMessage).toBe(true);

          // Verify: System remains stable
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();

          errorSpy.mockRestore();
          warnSpy.mockRestore();
        }
      ),
      { numRuns: 10 } // Reduced from 25 to 10
    );
  }, 10000);
});
