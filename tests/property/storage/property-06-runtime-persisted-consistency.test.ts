import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { RuntimeMappingUpdate } from '../../../src/lib/types/storage';

/**
 * Property 6: Runtime and Persisted State Consistency
 * 
 * For any storage operation, the runtime mappings should remain consistent 
 * with persisted preferences, with persisted state serving as the source of 
 * truth for conflicts.
 * 
 * Validates: Requirements 9.1, 9.2, 9.3
 */

describe('Property 6: Runtime and Persisted State Consistency', () => {
  let storageData: Record<string, any>;

  beforeEach(() => {
    // Reset storage data
    storageData = {};
    
    // Mock Chrome storage API
    vi.mocked(chrome.storage.sync.get).mockImplementation((keys: any, callback: any) => {
      if (typeof keys === 'function') {
        callback = keys;
        keys = null;
      }
      
      if (keys === null) {
        callback({ ...storageData });
      } else if (Array.isArray(keys)) {
        const result: Record<string, any> = {};
        keys.forEach(key => {
          if (storageData[key] !== undefined) {
            result[key] = storageData[key];
          }
        });
        callback(result);
      } else if (typeof keys === 'object') {
        const result: Record<string, any> = {};
        Object.keys(keys).forEach(key => {
          result[key] = storageData[key] !== undefined ? storageData[key] : keys[key];
        });
        callback(result);
      }
    });

    vi.mocked(chrome.storage.sync.set).mockImplementation((data: any, callback?: any) => {
      Object.assign(storageData, data);
      if (callback) callback();
    });

    // Mock bookmarks API for container folder checks
    vi.mocked(chrome.bookmarks.get).mockImplementation((id: any, callback: any) => {
      callback([{ id, title: 'Container', children: [] }]);
    });

    vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: any, callback: any) => {
      callback([]);
    });
  });

  it('should maintain consistency between runtime mappings and persisted preferences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s !== '__proto__' && s !== 'constructor'),
            syncEnabled: fc.boolean(),
            folderId: fc.string({ minLength: 1, maxLength: 20 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (groups) => {
          const manager = new StorageManager();
          await manager.initialize();

          // Set persisted preferences
          for (const group of groups) {
            await manager.updateGroupSyncSettings(group.name, {
              enabled: group.syncEnabled,
              lastSynced: Date.now(),
            });
          }

          // Update runtime mappings
          for (const group of groups) {
            await manager.updateMapping(group.name, {
              folderId: group.folderId,
              syncEnabled: group.syncEnabled,
              userAction: true,
            });
          }

          // Verify runtime state matches persisted state
          const allMappings = await manager.getAllMappings();
          for (const group of groups) {
            const mapping = allMappings[group.name];
            const settings = await manager.getGroupSyncSettings(group.name);
            
            expect(mapping).toBeDefined();
            expect(mapping.syncEnabled).toBe(settings.enabled);
            expect(mapping.syncEnabled).toBe(group.syncEnabled);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should use persisted state as source of truth after restart', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s !== '__proto__' && s !== 'constructor'),
        fc.boolean(),
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (groupName, persistedEnabled, runtimeEnabled, folderId) => {
          // First manager: set persisted preference
          const manager1 = new StorageManager();
          await manager1.initialize();
          await manager1.updateGroupSyncSettings(groupName, {
            enabled: persistedEnabled,
            lastSynced: Date.now(),
          });

          // Update runtime mapping with different value (without userAction)
          await manager1.updateMapping(groupName, {
            folderId,
            syncEnabled: runtimeEnabled,
            userAction: false, // Not a user action, should not persist
          });

          // Second manager: should restore from persisted state
          const manager2 = new StorageManager();
          await manager2.initialize();

          const settings = await manager2.getGroupSyncSettings(groupName);
          // Persisted state should be the source of truth
          expect(settings.enabled).toBe(persistedEnabled);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle conflicts by preferring persisted state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s !== '__proto__' && s !== 'constructor'),
            persistedEnabled: fc.boolean(),
            runtimeEnabled: fc.boolean(),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (groups) => {
          const manager = new StorageManager();
          await manager.initialize();

          // Set persisted preferences
          for (const group of groups) {
            await manager.updateGroupSyncSettings(group.name, {
              enabled: group.persistedEnabled,
              lastSynced: Date.now(),
            });
          }

          // Update runtime mappings with different values (non-user actions)
          for (const group of groups) {
            await manager.updateMapping(group.name, {
              syncEnabled: group.runtimeEnabled,
              userAction: false,
            });
          }

          // Create new manager instance (simulating restart)
          const manager2 = new StorageManager();
          await manager2.initialize();

          // Verify persisted state is restored
          for (const group of groups) {
            const settings = await manager2.getGroupSyncSettings(group.name);
            expect(settings.enabled).toBe(group.persistedEnabled);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should update persisted state when runtime changes are user-initiated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s !== '__proto__' && s !== 'constructor'),
        fc.boolean(),
        fc.boolean(),
        async (groupName, initialEnabled, newEnabled) => {
          const manager = new StorageManager();
          await manager.initialize();

          // Set initial persisted preference
          await manager.updateGroupSyncSettings(groupName, {
            enabled: initialEnabled,
            lastSynced: Date.now(),
          });

          // Update runtime mapping with user action
          await manager.updateMapping(groupName, {
            syncEnabled: newEnabled,
            userAction: true, // User-initiated change
          });

          // Verify persisted state was updated
          const settings = await manager.getGroupSyncSettings(groupName);
          expect(settings.enabled).toBe(newEnabled);

          // Verify persistence across restart
          const manager2 = new StorageManager();
          await manager2.initialize();
          const restoredSettings = await manager2.getGroupSyncSettings(groupName);
          expect(restoredSettings.enabled).toBe(newEnabled);
        }
      ),
      { numRuns: 100 }
    );
  });
});
