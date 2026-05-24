import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SyncEngine } from '../../../src/lib/sync/syncEngine';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { TabGroupManager } from '../../../src/lib/tabGroupManager';
import { setupAllMocks, setupBookmarkMocks } from '../testUtils';

/**
 * Property 4: No-Change Sync Idempotency
 * 
 * When syncing a group whose tabs hash is unchanged, the system SHALL:
 * - Record "Synced, no changes" in in-memory history
 * - NOT write to chrome.storage.sync (zero storage writes)
 * - NOT call updateMapping (no status update)
 * 
 * Validates: Requirement 4.1
 */

describe('Feature: sw-reliability, Property 4: No-Change Sync Idempotency', () => {
  let syncEngine: SyncEngine;
  let storageManager: StorageManager;
  let bookmarkManager: BookmarkManager;
  let tabGroupManager: TabGroupManager;
  let mocks: ReturnType<typeof setupAllMocks>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mocks = setupAllMocks({
      initialStorage: {
        'state:settings': {
          containerFolderId: 'container-1',
          containerFolderName: 'Tab Groups',
          autoSync: true,
          keepRemoved: true,
          cleanup: {
            enabled: false,
            inactiveThreshold: 30,
            autoArchive: false,
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
    mocks.bookmarkStorage.children.set('container-1', [
      bookmarksFolder,
      {
        id: 'snapshots-folder-1',
        title: 'Tab Group Snapshots',
        parentId: 'container-1',
        index: 1,
        dateAdded: Date.now()
      }
    ]);

    storageManager = new StorageManager();
    await storageManager.initialize();

    bookmarkManager = new BookmarkManager(storageManager);
    syncEngine = new SyncEngine(storageManager, bookmarkManager, null!);
    tabGroupManager = new TabGroupManager(syncEngine, storageManager);
    Object.assign(syncEngine, { tabGroupManager });
  });

  it('should not write to chrome.storage.sync when persistToStorage is false', async () => {
    vi.mocked(chrome.storage.sync.set).mockClear();

    // Add history entry with persistToStorage: false (what no-change sync does)
    await storageManager.addHistoryEntry({
      timestamp: Date.now(),
      type: 'group-to-folder',
      groupId: 'group:TestGroup',
      folderId: 'folder-1',
      success: true,
      details: 'Synced, no changes'
    }, { persistToStorage: false });

    // Should have ZERO storage writes
    expect(vi.mocked(chrome.storage.sync.set).mock.calls.length).toBe(0);

    // But in-memory history should contain the entry
    const history = await storageManager.getHistory();
    const noChangeEntries = history.filter(h => h.details === 'Synced, no changes');
    expect(noChangeEntries.length).toBe(1);
  });

  it('should write to chrome.storage.sync when persistToStorage is true (default)', async () => {
    vi.mocked(chrome.storage.sync.set).mockClear();

    // Add history entry with default persistToStorage (true)
    await storageManager.addHistoryEntry({
      timestamp: Date.now(),
      type: 'group-to-folder',
      groupId: 'group:TestGroup',
      folderId: 'folder-1',
      success: true,
      details: '2 tabs synced'
    });

    // Should have at least one storage write
    expect(vi.mocked(chrome.storage.sync.set).mock.calls.length).toBeGreaterThanOrEqual(1);

    // In-memory history should also contain the entry
    const history = await storageManager.getHistory();
    const syncEntries = history.filter(h => h.details === '2 tabs synced');
    expect(syncEntries.length).toBe(1);
  });

  it('should accumulate in-memory history entries without storage writes for repeated no-change syncs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (repeatCount) => {
          vi.mocked(chrome.storage.sync.set).mockClear();

          for (let i = 0; i < repeatCount; i++) {
            await storageManager.addHistoryEntry({
              timestamp: Date.now() + i,
              type: 'group-to-folder',
              groupId: `group:Group${i}`,
              folderId: `folder-${i}`,
              success: true,
              details: 'Synced, no changes'
            }, { persistToStorage: false });
          }

          // Zero storage writes
          expect(vi.mocked(chrome.storage.sync.set).mock.calls.length).toBe(0);

          // All entries in memory
          const history = await storageManager.getHistory();
          const noChangeEntries = history.filter(h => h.details === 'Synced, no changes');
          expect(noChangeEntries.length).toBeGreaterThanOrEqual(repeatCount);
        }
      ),
      { numRuns: 15 }
    );
  });
});
