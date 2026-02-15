import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { StorageManager } from '../../../src/lib/storage/storageManager';

/**
 * Property 5: Backward Compatibility
 * 
 * When initializing with old-format storage data (no containerFolderName),
 * the system SHALL:
 * - Preserve all existing settings and preferences
 * - Populate containerFolderName on first resolveContainerFolder() call
 * - Not corrupt or lose any data during migration
 * 
 * Validates: Requirements 2.7, backward compat
 */

describe('Feature: sw-reliability, Property 5: Backward Compatibility', () => {
  let storageData: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    storageData = {};

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

  it('should preserve all settings when containerFolderName is missing (old format)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 1, max: 60 }),
        async (autoSync, keepRemoved, syncInterval) => {
          const folderId = 'old-format-folder';
          const folderTitle = 'My Bookmarks';

          // Mock: folder exists at stored ID
          vi.mocked(chrome.bookmarks.get).mockImplementation(((id: any) => {
            if (id === folderId) {
              return Promise.resolve([{
                id: folderId, title: folderTitle, parentId: '0',
                index: 0, dateAdded: Date.now()
              }]);
            }
            return Promise.resolve([]);
          }) as any);

          // Seed storage with OLD format (no containerFolderName)
          storageData = {
            'state:settings': {
              autoSync,
              containerFolderId: folderId,
              // containerFolderName intentionally MISSING
              syncInterval,
              keepRemoved,
              cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
            },
            'pref:GroupA': { syncEnabled: true, lastSeen: Date.now(), lastSynced: Date.now() },
            'pref:GroupB': { syncEnabled: false, lastSeen: Date.now(), lastSynced: 0 }
          };

          const manager = new StorageManager();
          await manager.initialize();

          // All original settings preserved
          const settings = await manager.getSettings();
          expect(settings.autoSync).toBe(autoSync);
          expect(settings.keepRemoved).toBe(keepRemoved);
          expect(settings.containerFolderId).toBe(folderId);

          // containerFolderName populated after resolution
          const result = await manager.resolveContainerFolder();
          expect(result).toBe('exists');
          const updatedSettings = await manager.getSettings();
          expect(updatedSettings.containerFolderName).toBe(folderTitle);

          // Sync preferences preserved
          const groupASettings = await manager.getGroupSyncSettings('GroupA');
          expect(groupASettings.enabled).toBe(true);
          const groupBSettings = await manager.getGroupSyncSettings('GroupB');
          expect(groupBSettings.enabled).toBe(false);
        }
      ),
      { numRuns: 15 }
    );
  });

  it('should handle old format with no containerFolderId gracefully', async () => {
    storageData = {
      'state:settings': {
        autoSync: true,
        // No containerFolderId, no containerFolderName
        keepRemoved: false,
        cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
      }
    };

    const manager = new StorageManager();
    await manager.initialize();

    const settings = await manager.getSettings();
    expect(settings.autoSync).toBe(true);
    expect(settings.containerFolderId).toBeUndefined();
    expect(settings.containerFolderName).toBeUndefined();

    // resolveContainerFolder returns 'deleted' when no ID stored
    const result = await manager.resolveContainerFolder();
    expect(result).toBe('deleted');
  });

  it('should preserve sync preferences across initialization with new fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
        async (groupNames) => {
          // Deduplicate names
          const uniqueNames = [...new Set(groupNames)];

          // Seed with preferences
          storageData = {
            'state:settings': {
              autoSync: true,
              keepRemoved: true,
              cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
            }
          };
          uniqueNames.forEach(name => {
            storageData[`pref:${name}`] = {
              syncEnabled: true,
              lastSeen: Date.now(),
              lastSynced: Date.now()
            };
          });

          const manager = new StorageManager();
          await manager.initialize();

          // All preferences preserved
          for (const name of uniqueNames) {
            const groupSettings = await manager.getGroupSyncSettings(name);
            expect(groupSettings.enabled).toBe(true);
          }
        }
      ),
      { numRuns: 15 }
    );
  });
});
