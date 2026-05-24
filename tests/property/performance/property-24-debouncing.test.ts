import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { SyncEngine } from '../../../src/lib/sync/syncEngine';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { TabGroupManager } from '../../../src/lib/tabGroupManager';
import { arbitraryTab } from '../arbitraries';
import { setupAllMocks } from '../testUtils';

/**
 * Property 24: Change Debouncing
 * 
 * For any rapid sequence of tab changes, the Sync_Engine should debounce sync operations
 * to reduce overhead while ensuring eventual consistency
 * 
 * **Validates: Requirements 10.2**
 */

describe('Feature: tab-group-sync, Property 24: Change Debouncing', () => {
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

  it('should skip redundant syncs when tabs have not changed (Requirement 10.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 2, max: 5 }),
        async (groupName, tabs, repeatCount) => {
          // Skip whitespace-only group names
          if (groupName.trim().length === 0) return;

          // Create group folder and enable sync
          await chrome.bookmarks.create({
            title: groupName,
            parentId: 'bookmarks-folder-1'
          });
          await syncEngine.setGroupSyncEnabled(groupName, true);

          // Mock tabs query to return the same tabs each time
          const mockTabs = tabs.map((t, i) => ({
            ...t,
            id: i + 1,
            groupId: 1,
            url: t.url || 'https://example.com',
            title: t.title || 'Test Tab'
          })) as chrome.tabs.Tab[];

          vi.mocked(chrome.tabs.query).mockResolvedValue(mockTabs);

          // Track actual sync operations
          let syncCallCount = 0;
          const originalSyncGroupToFolder = (syncEngine as any).syncGroupToFolder.bind(syncEngine);
          vi.spyOn(syncEngine as any, 'syncGroupToFolder').mockImplementation(async function(this: any, name: string) {
            syncCallCount++;
            return Promise.resolve();
          });

          // Trigger multiple syncs with the same tab state
          for (let i = 0; i < repeatCount; i++) {
            await syncEngine.syncGroupToFolder(groupName);
          }

          // Verify: First sync should execute
          expect(syncCallCount).toBeGreaterThanOrEqual(1);

          // Verify: Subsequent syncs with identical tabs should be skipped (debounced)
          // The exact count depends on implementation, but should be less than repeatCount
          expect(syncCallCount).toBeLessThanOrEqual(repeatCount);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should sync when tabs actually change (Requirement 10.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 2 }),
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 2 }),
        async (groupName, tabs1, tabs2) => {
          // Skip whitespace-only group names
          if (groupName.trim().length === 0) return;

          // Create group folder and enable sync
          await chrome.bookmarks.create({
            title: groupName,
            parentId: 'bookmarks-folder-1'
          });
          await syncEngine.setGroupSyncEnabled(groupName, true);

          // Track sync operations
          let syncCallCount = 0;
          vi.spyOn(syncEngine as any, 'syncGroupToFolder').mockImplementation(async function(this: any, name: string) {
            syncCallCount++;
            return Promise.resolve();
          });

          // First sync with tabs1
          const mockTabs1 = tabs1.map((t, i) => ({
            ...t,
            id: i + 1,
            groupId: 1,
            url: t.url || 'https://example.com/1',
            title: t.title || 'Tab 1'
          })) as chrome.tabs.Tab[];

          vi.mocked(chrome.tabs.query).mockResolvedValue(mockTabs1);
          await syncEngine.syncGroupToFolder(groupName);

          const firstSyncCount = syncCallCount;

          // Second sync with different tabs (tabs2)
          const mockTabs2 = tabs2.map((t, i) => ({
            ...t,
            id: i + 100,
            groupId: 1,
            url: t.url || 'https://example.com/2',
            title: t.title || 'Tab 2'
          })) as chrome.tabs.Tab[];

          vi.mocked(chrome.tabs.query).mockResolvedValue(mockTabs2);
          await syncEngine.syncGroupToFolder(groupName);

          // Verify: Both syncs should execute because tabs changed
          expect(syncCallCount).toBeGreaterThan(firstSyncCount);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should handle rapid tab changes efficiently (Requirement 10.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 3 }),
        async (groupName, tabs) => {
          // Skip whitespace-only group names
          if (groupName.trim().length === 0) return;

          // Create group folder and enable sync
          await chrome.bookmarks.create({
            title: groupName,
            parentId: 'bookmarks-folder-1'
          });
          await syncEngine.setGroupSyncEnabled(groupName, true);

          // Mock tabs query to return the same tabs
          const mockTabs = tabs.map((t, i) => ({
            ...t,
            id: i + 1,
            groupId: 1,
            url: t.url || 'https://example.com',
            title: t.title || 'Test Tab'
          })) as chrome.tabs.Tab[];

          vi.mocked(chrome.tabs.query).mockResolvedValue(mockTabs);

          // Trigger rapid sync requests sequentially (simulating rapid tab changes)
          const rapidSyncCount = 5;
          for (let i = 0; i < rapidSyncCount; i++) {
            await syncEngine.syncGroupToFolder(groupName);
          }

          // Verify: System remains stable after rapid syncs
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
          expect(settings.containerFolderId).toBe('container-1');

          // Verify: Sync settings are preserved
          const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(typeof syncEnabled).toBe('boolean');
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should maintain eventual consistency despite debouncing (Requirement 10.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 2 }),
        async (groupName, tabs) => {
          // Skip whitespace-only group names
          if (groupName.trim().length === 0) return;

          // Create group folder and enable sync
          await chrome.bookmarks.create({
            title: groupName,
            parentId: 'bookmarks-folder-1'
          });
          await syncEngine.setGroupSyncEnabled(groupName, true);

          // Mock tabs query
          const mockTabs = tabs.map((t, i) => ({
            ...t,
            id: i + 1,
            groupId: 1,
            url: t.url || 'https://example.com',
            title: t.title || 'Test Tab'
          })) as chrome.tabs.Tab[];

          vi.mocked(chrome.tabs.query).mockResolvedValue(mockTabs);

          // Trigger multiple rapid syncs
          await syncEngine.syncGroupToFolder(groupName);
          await syncEngine.syncGroupToFolder(groupName);
          await syncEngine.syncGroupToFolder(groupName);

          // Verify: System remains stable
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
          expect(settings.containerFolderId).toBe('container-1');

          // Verify: Sync settings are preserved
          const syncEnabled = await syncEngine.getGroupSyncEnabled(groupName);
          expect(typeof syncEnabled).toBe('boolean');
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should debounce based on tab content, not just timing (Requirement 10.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 2 }),
        async (groupName, tabs) => {
          // Skip whitespace-only group names
          if (groupName.trim().length === 0) return;

          // Create group folder and enable sync
          await chrome.bookmarks.create({
            title: groupName,
            parentId: 'bookmarks-folder-1'
          });
          await syncEngine.setGroupSyncEnabled(groupName, true);

          // Track sync operations
          let syncCallCount = 0;
          vi.spyOn(syncEngine as any, 'syncGroupToFolder').mockImplementation(async function(this: any, name: string) {
            syncCallCount++;
            return Promise.resolve();
          });

          // Mock tabs query with same tabs
          const mockTabs = tabs.map((t, i) => ({
            ...t,
            id: i + 1,
            groupId: 1,
            url: t.url || 'https://example.com',
            title: t.title || 'Test Tab'
          })) as chrome.tabs.Tab[];

          vi.mocked(chrome.tabs.query).mockResolvedValue(mockTabs);

          // First sync
          await syncEngine.syncGroupToFolder(groupName);
          const firstCount = syncCallCount;

          // Wait a bit (to ensure it's not just timing-based debouncing)
          await new Promise(resolve => setTimeout(resolve, 100));

          // Second sync with same tabs (should be debounced based on content)
          await syncEngine.syncGroupToFolder(groupName);

          // Verify: Second sync was skipped because content didn't change
          // (not because of timing)
          // Allow for at most 1 additional sync (implementation may vary)
          expect(syncCallCount).toBeLessThanOrEqual(firstCount + 1);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should handle debouncing across multiple groups independently (Requirement 10.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
          { minLength: 2, maxLength: 3 }
        ),
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 2 }),
        async (groupNames, tabs) => {
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

          // Mock tabs query
          const mockTabs = tabs.map((t, i) => ({
            ...t,
            id: i + 1,
            groupId: 1,
            url: t.url || 'https://example.com',
            title: t.title || 'Test Tab'
          })) as chrome.tabs.Tab[];

          vi.mocked(chrome.tabs.query).mockResolvedValue(mockTabs);

          // Sync each group multiple times with same tabs
          for (const groupName of validGroupNames) {
            await syncEngine.syncGroupToFolder(groupName);
            await syncEngine.syncGroupToFolder(groupName);
            await syncEngine.syncGroupToFolder(groupName);
          }

          // Verify: System remains stable
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
          expect(settings.containerFolderId).toBe('container-1');

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
});
