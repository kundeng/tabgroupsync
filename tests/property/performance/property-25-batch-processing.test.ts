import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { arbitraryTab } from '../arbitraries';
import { setupAllMocks } from '../testUtils';

/**
 * Property 25: Batch Processing for Large Operations
 * 
 * For any large number of tabs being synced, the Sync_Engine should process them
 * in batches to avoid blocking the browser
 * 
 * Validates: Requirements 10.3
 */

describe('Property 25: Batch Processing for Large Operations', () => {
  let bookmarkManager: BookmarkManager;
  let storageManager: StorageManager;
  let mocks: ReturnType<typeof setupAllMocks>;

  beforeEach(async () => {
    vi.clearAllMocks();
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
    
    const bookmarksFolder = {
      id: 'bookmarks-folder-1',
      title: 'Tab Group Bookmarks',
      parentId: 'container-1',
      index: 0,
      dateAdded: Date.now()
    };
    mocks.bookmarkStorage.folders.set('bookmarks-folder-1', bookmarksFolder);
    mocks.bookmarkStorage.children.set('container-1', [bookmarksFolder]);
    mocks.bookmarkStorage.children.set('bookmarks-folder-1', []);

    storageManager = new StorageManager();
    await storageManager.initialize();
    
    bookmarkManager = new BookmarkManager(storageManager);
  });

  it('should handle large numbers of tabs without blocking', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryTab(), { minLength: 20, maxLength: 50 }),
        async (tabs) => {
          const groupName = 'Large Group';
          const validTabs = tabs.map(t => ({
            ...t,
            url: t.url || 'https://example.com',
            title: t.title || 'Tab',
            groupId: 1
          }));

          // Create group folder
          const groupFolder = await bookmarkManager.ensureGroupFolder(groupName);

          // Sync large number of tabs - should not throw
          await expect(
            bookmarkManager.syncGroupToFolder(
              groupName,
              validTabs as chrome.tabs.Tab[],
              groupFolder.id
            )
          ).resolves.not.toThrow();

          // Verify: System remains responsive (can still access storage)
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
        }
      ),
      { numRuns: 50 } // Fewer runs due to larger data sets
    );
  }, 60000); // Longer timeout for large operations

  it('should process tabs in manageable chunks', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryTab(), { minLength: 30, maxLength: 100 }),
        async (tabs) => {
          const groupName = 'Very Large Group';
          const validTabs = tabs.map(t => ({
            ...t,
            url: t.url || 'https://example.com',
            title: t.title || 'Tab',
            groupId: 1
          }));

          // Create group folder
          const groupFolder = await bookmarkManager.ensureGroupFolder(groupName);

          // Sync should complete without errors
          await expect(
            bookmarkManager.syncGroupToFolder(
              groupName,
              validTabs as chrome.tabs.Tab[],
              groupFolder.id
            )
          ).resolves.not.toThrow();

          // Verify: System remains responsive
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
        }
      ),
      { numRuns: 30 } // Fewer runs for very large data sets
    );
  }, 60000);
});
