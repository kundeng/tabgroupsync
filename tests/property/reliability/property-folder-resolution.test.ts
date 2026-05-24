import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { setupAllMocks } from '../testUtils';

/**
 * Property 2: Container Folder Resolution
 * 
 * For any combination of folder states (ID valid, ID invalid but signature found,
 * API errors, genuine deletion), the system SHALL:
 * - Preserve config on transient errors ('unverified')
 * - Update config on relocation ('relocated')
 * - Clear config only on confirmed deletion ('deleted')
 * 
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

describe('Feature: sw-reliability, Property 2: Container Folder Resolution', () => {
  let storageData: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    storageData = {};

    // Setup storage mocks
    vi.mocked(chrome.storage.sync.get).mockImplementation((keys: any, callback?: any) => {
      if (typeof keys === 'function') {
        callback = keys;
        keys = null;
      }
      let result: Record<string, any> = {};
      if (keys === null) {
        result = { ...storageData };
      } else if (Array.isArray(keys)) {
        keys.forEach((key: string) => {
          if (storageData[key] !== undefined) result[key] = storageData[key];
        });
      } else if (typeof keys === 'object') {
        Object.keys(keys).forEach(key => {
          result[key] = storageData[key] !== undefined ? storageData[key] : keys[key];
        });
      }
      if (callback) callback(result);
      return Promise.resolve(result);
    });

    vi.mocked(chrome.storage.sync.set).mockImplementation((data: any, callback?: any) => {
      Object.assign(storageData, data);
      if (callback) callback();
      return Promise.resolve();
    });
  });

  it('should return "exists" when stored ID is valid', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (folderId, folderName) => {
          // Setup: folder exists at stored ID
          vi.mocked(chrome.bookmarks.get).mockImplementation(((id: any) => {
            if (id === folderId) {
              return Promise.resolve([{ id: folderId, title: folderName, parentId: '0', index: 0, dateAdded: Date.now() }]);
            }
            return Promise.resolve([]);
          }) as any);

          storageData = {
            'state:settings': {
              autoSync: false,
              containerFolderId: folderId,
              containerFolderName: folderName,
              keepRemoved: false,
              cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
            }
          };

          const manager = new StorageManager();
          await manager.initialize();
          const result = await manager.resolveContainerFolder();

          expect(result).toBe('exists');
          const settings = await manager.getSettings();
          expect(settings.containerFolderId).toBe(folderId);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should return "deleted" and clear config when folder is genuinely gone and no signature match', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        async (folderId) => {
          // Setup: folder does not exist, no search results
          vi.mocked(chrome.bookmarks.get).mockImplementation((() => {
            return Promise.resolve([]);
          }) as any);
          vi.mocked(chrome.bookmarks.search).mockImplementation((() => {
            return Promise.resolve([]);
          }) as any);

          storageData = {
            'state:settings': {
              autoSync: false,
              containerFolderId: folderId,
              containerFolderName: 'My Tab Groups',
              keepRemoved: false,
              cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
            }
          };

          const manager = new StorageManager();
          await manager.initialize();
          const result = await manager.resolveContainerFolder();

          expect(result).toBe('deleted');
          const settings = await manager.getSettings();
          expect(settings.containerFolderId).toBeUndefined();
          expect(settings.containerFolderName).toBeUndefined();
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should relocate folder and update config when ID invalid but signature found', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (oldId, newId, folderName) => {
          // Ensure IDs are different
          if (oldId === newId) return;

          // Setup: old ID not found, but search finds folder with signature at new ID
          vi.mocked(chrome.bookmarks.get).mockImplementation(((id: any) => {
            if (id === newId) {
              return Promise.resolve([{ id: newId, title: folderName, parentId: '0', index: 0, dateAdded: Date.now() }]);
            }
            return Promise.resolve([]);
          }) as any);

          vi.mocked(chrome.bookmarks.search).mockImplementation((() => {
            return Promise.resolve([
              { id: newId, title: folderName, parentId: '0', index: 0, dateAdded: Date.now() }
            ]);
          }) as any);

          vi.mocked(chrome.bookmarks.getChildren).mockImplementation(((id: any) => {
            if (id === newId) {
              return Promise.resolve([
                { id: 'bm-1', title: 'Tab Group Bookmarks', parentId: newId, index: 0, dateAdded: Date.now() },
                { id: 'sn-1', title: 'Tab Group Snapshots', parentId: newId, index: 1, dateAdded: Date.now() },
              ]);
            }
            return Promise.resolve([]);
          }) as any);

          storageData = {
            'state:settings': {
              autoSync: false,
              containerFolderId: oldId,
              containerFolderName: folderName,
              keepRemoved: false,
              cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
            }
          };

          // initialize() calls performMaintenance → resolveContainerFolder
          // which relocates the folder during init
          const manager = new StorageManager();
          await manager.initialize();

          // After init, the ID should be updated to the new location
          const settings = await manager.getSettings();
          expect(settings.containerFolderId).toBe(newId);
          expect(settings.containerFolderName).toBe(folderName);

          // A subsequent resolve should return 'exists' since ID is now valid
          const result = await manager.resolveContainerFolder();
          expect(result).toBe('exists');
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should return "unverified" and preserve config on transient API errors', async () => {
    // Each run triggers retries with delays (3 × 500ms backoff), so keep runs low
    const folderId = 'test-folder-id';
    const folderName = 'Test Folder';

    // Setup: API always throws transient errors (not "Can't find" type)
    vi.mocked(chrome.bookmarks.get).mockImplementation((() => {
      return Promise.reject(new Error('Network error'));
    }) as any);

    storageData = {
      'state:settings': {
        autoSync: false,
        containerFolderId: folderId,
        containerFolderName: folderName,
        keepRemoved: false,
        cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
      }
    };

    const manager = new StorageManager();
    await manager.initialize();
    const result = await manager.resolveContainerFolder();

    expect(result).toBe('unverified');
    // Config MUST be preserved
    const settings = await manager.getSettings();
    expect(settings.containerFolderId).toBe(folderId);
    expect(settings.containerFolderName).toBe(folderName);
  }, 15000);

  it('should populate containerFolderName on first resolution when missing (backward compat)', async () => {
    const folderId = 'existing-folder-123';
    const folderTitle = 'My Tab Groups';

    vi.mocked(chrome.bookmarks.get).mockImplementation(((id: any) => {
      if (id === folderId) {
        return Promise.resolve([{ id: folderId, title: folderTitle, parentId: '0', index: 0, dateAdded: Date.now() }]);
      }
      return Promise.resolve([]);
    }) as any);

    storageData = {
      'state:settings': {
        autoSync: false,
        containerFolderId: folderId,
        // containerFolderName intentionally missing (old format)
        keepRemoved: false,
        cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
      }
    };

    const manager = new StorageManager();
    await manager.initialize();
    const result = await manager.resolveContainerFolder();

    expect(result).toBe('exists');
    const settings = await manager.getSettings();
    expect(settings.containerFolderId).toBe(folderId);
    expect(settings.containerFolderName).toBe(folderTitle);
  });

  it('should fall through to "deleted" when ID not found and no containerFolderName stored', async () => {
    vi.mocked(chrome.bookmarks.get).mockImplementation((() => {
      return Promise.resolve([]);
    }) as any);

    storageData = {
      'state:settings': {
        autoSync: false,
        containerFolderId: 'gone-folder',
        // No containerFolderName — can't do signature search
        keepRemoved: false,
        cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
      }
    };

    const manager = new StorageManager();
    await manager.initialize();
    const result = await manager.resolveContainerFolder();

    expect(result).toBe('deleted');
    const settings = await manager.getSettings();
    expect(settings.containerFolderId).toBeUndefined();
  });
});
