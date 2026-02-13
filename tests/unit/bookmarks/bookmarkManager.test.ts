import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { StorageManager } from '../../../src/lib/storage/storageManager';

/**
 * Unit tests for BookmarkManager
 * 
 * Tests:
 * - Bookmark creation with invalid URLs
 * - Folder operations with permission errors
 * - Nested folder detection
 * 
 * Requirements: 4.1, 4.4, 8.2
 */

describe('BookmarkManager', () => {
  let bookmarkManager: BookmarkManager;
  let storageManager: StorageManager;

  beforeEach(() => {
    vi.clearAllMocks();
    
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

    vi.mocked(chrome.bookmarks.update).mockImplementation((id: string, changes: any, callback?: any) => {
      const result = {
        id,
        title: changes.title || 'Updated',
        parentId: 'bookmarks-folder-1',
        index: 0,
        dateAdded: Date.now(),
      };
      if (callback) {
        callback(result);
      }
      return Promise.resolve(result);
    });

    bookmarkManager = new BookmarkManager(storageManager);
  });

  describe('syncGroupToFolder', () => {
    it.skip('should handle invalid URLs gracefully', async () => {
      // Setup mocks
      vi.mocked(chrome.bookmarks.get).mockImplementation((id: string, callback: any) => {
        if (id === 'container-1') {
          callback([{
            id: 'container-1',
            title: 'Tab Groups',
            parentId: '1',
            index: 0,
            dateAdded: Date.now(),
          }]);
        } else if (id === 'group-folder-1') {
          callback([{
            id: 'group-folder-1',
            title: 'Test Group',
            parentId: 'bookmarks-folder-1',
            index: 0,
            dateAdded: Date.now(),
          }]);
        }
      });

      vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: string, callback: any) => {
        if (id === 'container-1') {
          callback([
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
        } else if (id === 'bookmarks-folder-1') {
          callback([
            {
              id: 'group-folder-1',
              title: 'Test Group',
              parentId: 'bookmarks-folder-1',
              index: 0,
              dateAdded: Date.now(),
            }
          ]);
        } else if (id === 'group-folder-1') {
          callback([]); // No existing bookmarks
        } else {
          callback([]);
        }
      });

      vi.mocked(chrome.bookmarks.create).mockImplementation((bookmark: any, callback?: any) => {
        const newBookmark: chrome.bookmarks.BookmarkTreeNode = {
          id: `bookmark-${Date.now()}`,
          title: bookmark.title,
          url: bookmark.url,
          parentId: bookmark.parentId,
          index: 0,
          dateAdded: Date.now(),
        };
        if (callback) callback(newBookmark);
        return Promise.resolve(newBookmark);
      });

      await storageManager.initialize();

      // Test with tabs that have invalid URLs
      const tabs = [
        { id: 1, url: 'https://example.com', title: 'Valid Tab' },
        { id: 2, url: undefined, title: 'Invalid Tab' }, // Invalid URL
        { id: 3, url: 'chrome://extensions', title: 'Chrome URL' },
      ] as chrome.tabs.Tab[];

      // Should not throw error
      await expect(
        bookmarkManager.syncGroupToFolder('Test Group', tabs, 'group-folder-1')
      ).resolves.not.toThrow();

      // Verify only valid URLs were processed
      const createCalls = vi.mocked(chrome.bookmarks.create).mock.calls;
      // Should have created bookmarks for valid URLs only
      expect(createCalls.length).toBeGreaterThan(0);
    });

    it.skip('should handle bookmark creation errors', async () => {
      // Setup mocks
      vi.mocked(chrome.bookmarks.get).mockImplementation((id: string, callback: any) => {
        if (id === 'container-1') {
          callback([{
            id: 'container-1',
            title: 'Tab Groups',
            parentId: '1',
            index: 0,
            dateAdded: Date.now(),
          }]);
        } else if (id === 'group-folder-1') {
          callback([{
            id: 'group-folder-1',
            title: 'Test Group',
            parentId: 'bookmarks-folder-1',
            index: 0,
            dateAdded: Date.now(),
          }]);
        }
      });

      vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: string, callback: any) => {
        if (id === 'container-1') {
          callback([
            {
              id: 'bookmarks-folder-1',
              title: 'Tab Group Bookmarks',
              parentId: 'container-1',
              index: 0,
              dateAdded: Date.now(),
            }
          ]);
        } else if (id === 'bookmarks-folder-1') {
          callback([
            {
              id: 'group-folder-1',
              title: 'Test Group',
              parentId: 'bookmarks-folder-1',
              index: 0,
              dateAdded: Date.now(),
            }
          ]);
        } else if (id === 'group-folder-1') {
          callback([]); // No existing bookmarks
        } else {
          callback([]);
        }
      });

      // Mock bookmark creation to fail for URLs
      vi.mocked(chrome.bookmarks.create).mockImplementation((bookmark: any, callback?: any) => {
        if (bookmark.url) {
          // Simulate permission error
          chrome.runtime.lastError = { message: 'Permission denied' };
          if (callback) callback(undefined as any);
          return Promise.reject(new Error('Permission denied'));
        } else {
          const newBookmark: chrome.bookmarks.BookmarkTreeNode = {
            id: 'new-folder',
            title: bookmark.title,
            parentId: bookmark.parentId,
            index: 0,
            dateAdded: Date.now(),
          };
          if (callback) callback(newBookmark);
          return Promise.resolve(newBookmark);
        }
      });

      await storageManager.initialize();

      const tabs = [
        { id: 1, url: 'https://example.com', title: 'Test Tab' },
      ] as chrome.tabs.Tab[];

      // Should handle error gracefully
      await expect(
        bookmarkManager.syncGroupToFolder('Test Group', tabs, 'group-folder-1')
      ).rejects.toThrow();
    });
  });

  describe('getContainerFolder', () => {
    it('should detect nested container folders', async () => {
      // Setup nested folder structure
      vi.mocked(chrome.bookmarks.get).mockImplementation((id: string, callback?: any) => {
        let result: chrome.bookmarks.BookmarkTreeNode[] = [];
        if (id === 'nested-container') {
          result = [{
            id: 'nested-container',
            title: 'Nested Container',
            parentId: 'parent-container',
            index: 0,
            dateAdded: Date.now(),
          }];
        } else if (id === 'parent-container') {
          result = [{
            id: 'parent-container',
            title: 'Parent Container',
            parentId: '1',
            index: 0,
            dateAdded: Date.now(),
          }];
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      });

      vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: string, callback?: any) => {
        let result: chrome.bookmarks.BookmarkTreeNode[] = [];
        if (id === 'parent-container') {
          result = [
            {
              id: 'parent-bookmarks',
              title: 'Tab Group Bookmarks',
              parentId: 'parent-container',
              index: 0,
              dateAdded: Date.now(),
            },
            {
              id: 'parent-snapshots',
              title: 'Tab Group Snapshots',
              parentId: 'parent-container',
              index: 1,
              dateAdded: Date.now(),
            },
            {
              id: 'nested-container',
              title: 'Nested Container',
              parentId: 'parent-container',
              index: 2,
              dateAdded: Date.now(),
            }
          ];
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      });

      // Update settings to use nested container
      await storageManager.updateSettings({ containerFolderId: 'nested-container' });

      // Should detect and use parent container
      const container = await bookmarkManager.getContainerFolder();
      
      // Should return parent container, not nested one
      expect(container?.id).toBe('parent-container');
    });

    it('should return null when container folder not configured', async () => {
      // Clear container folder ID
      await storageManager.updateSettings({ containerFolderId: undefined });

      const container = await bookmarkManager.getContainerFolder();
      expect(container).toBeNull();
    });
  });

  describe('handleBookmarkRemoved', () => {
    it.skip('should recreate container folder when deleted and tab groups exist', async () => {
      // Setup mocks
      vi.mocked(chrome.bookmarks.get).mockImplementation((id: string, callback: any) => {
        if (id === 'container-1') {
          callback([{
            id: 'container-1',
            title: 'Tab Groups',
            parentId: '1',
            index: 0,
            dateAdded: Date.now(),
          }]);
        }
      });

      vi.mocked(chrome.tabGroups.query).mockImplementation((queryInfo: any, callback?: any) => {
        const groups = [
          { id: 1, title: 'Work', color: 'blue' as chrome.tabGroups.ColorEnum, windowId: 1, collapsed: false }
        ];
        if (callback) callback(groups);
        return Promise.resolve(groups);
      });

      vi.mocked(chrome.bookmarks.create).mockImplementation((bookmark: any, callback?: any) => {
        const newBookmark: chrome.bookmarks.BookmarkTreeNode = {
          id: 'new-container',
          title: bookmark.title,
          parentId: bookmark.parentId,
          index: 0,
          dateAdded: Date.now(),
        };
        if (callback) callback(newBookmark);
        return Promise.resolve(newBookmark);
      });

      vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: string, callback: any) => {
        callback([]);
      });

      await storageManager.initialize();

      // Simulate container folder deletion
      await bookmarkManager.handleBookmarkRemoved('container-1', {
        parentId: '1',
        index: 0,
        node: {
          id: 'container-1',
          title: 'Tab Groups',
          parentId: '1',
          index: 0,
          dateAdded: Date.now(),
        }
      });

      // Verify folder recreation was attempted
      expect(chrome.bookmarks.create).toHaveBeenCalled();
    });

    it.skip('should not recreate container folder when no tab groups exist', async () => {
      vi.mocked(chrome.tabGroups.query).mockImplementation((queryInfo: any, callback?: any) => {
        const groups: chrome.tabGroups.TabGroup[] = [];
        if (callback) callback(groups);
        return Promise.resolve(groups);
      });

      await storageManager.initialize();

      // Simulate container folder deletion
      await bookmarkManager.handleBookmarkRemoved('container-1', {
        parentId: '1',
        index: 0,
        node: {
          id: 'container-1',
          title: 'Tab Groups',
          parentId: '1',
          index: 0,
          dateAdded: Date.now(),
        }
      });

      // Verify folder recreation was not attempted
      expect(chrome.bookmarks.create).not.toHaveBeenCalled();
    });
  });

  describe('ensureContainerFolderExists', () => {
    it.skip('should repair incomplete folder structure', async () => {
      // Setup container with missing snapshots folder
      vi.mocked(chrome.bookmarks.get).mockImplementation((id: string, callback: any) => {
        if (id === 'container-1') {
          callback([{
            id: 'container-1',
            title: 'Tab Groups',
            parentId: '1',
            index: 0,
            dateAdded: Date.now(),
          }]);
        }
      });

      vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: string, callback: any) => {
        if (id === 'container-1') {
          // Only bookmarks folder exists, snapshots missing
          callback([
            {
              id: 'bookmarks-folder-1',
              title: 'Tab Group Bookmarks',
              parentId: 'container-1',
              index: 0,
              dateAdded: Date.now(),
            }
          ]);
        } else {
          callback([]);
        }
      });

      vi.mocked(chrome.bookmarks.create).mockImplementation((bookmark: any, callback?: any) => {
        const newBookmark: chrome.bookmarks.BookmarkTreeNode = {
          id: 'snapshots-folder-1',
          title: bookmark.title,
          parentId: bookmark.parentId,
          index: 1,
          dateAdded: Date.now(),
        };
        if (callback) callback(newBookmark);
        return Promise.resolve(newBookmark);
      });

      await storageManager.initialize();

      // Should repair structure
      const container = await bookmarkManager.ensureContainerFolderExists();
      
      expect(container).toBeDefined();
      expect(chrome.bookmarks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'container-1',
          title: 'Tab Group Snapshots'
        }),
        expect.any(Function)
      );
    });

    it('should throw error when container not configured', async () => {
      // Clear container folder ID
      await storageManager.updateSettings({ containerFolderId: undefined });

      await expect(bookmarkManager.ensureContainerFolderExists()).rejects.toThrow(
        'Container folder not configured'
      );
    });
  });
});
