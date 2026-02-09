import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { GroupSyncSettings } from '../../../src/lib/types/storage';

/**
 * Property 5: Sync Preference Persistence
 * 
 * For any tab group, when sync is toggled on or off, the preference should 
 * persist across browser restarts and be restored correctly.
 * 
 * Validates: Requirements 3.1, 7.1
 */

describe('Property 5: Sync Preference Persistence', () => {
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
        // Return all data
        callback({ ...storageData });
      } else if (Array.isArray(keys)) {
        // Return specific keys
        const result: Record<string, any> = {};
        keys.forEach(key => {
          if (storageData[key] !== undefined) {
            result[key] = storageData[key];
          }
        });
        callback(result);
      } else if (typeof keys === 'object') {
        // Return specific keys with defaults
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
  });

  it('should persist sync preferences across storage manager instances', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random group names (excluding problematic names)
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => 
              s.trim().length > 0 && 
              s !== '__proto__' && 
              s !== 'constructor' && 
              s !== 'prototype'
            ),
            syncEnabled: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (groups) => {
          // Create first storage manager instance
          const manager1 = new StorageManager();
          await manager1.initialize();

          // Set sync preferences for all groups
          for (const group of groups) {
            await manager1.updateGroupSyncSettings(group.name, {
              enabled: group.syncEnabled,
              lastSynced: Date.now(),
            });
          }

          // Create second storage manager instance (simulating browser restart)
          const manager2 = new StorageManager();
          await manager2.initialize();

          // Verify all preferences were restored correctly
          for (const group of groups) {
            const settings = await manager2.getGroupSyncSettings(group.name);
            expect(settings.enabled).toBe(group.syncEnabled);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve sync preferences when toggling multiple times', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => 
          s.trim().length > 0 && 
          s !== '__proto__' && 
          s !== 'constructor' && 
          s !== 'prototype'
        ),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
        async (groupName, toggleSequence) => {
          const manager = new StorageManager();
          await manager.initialize();

          // Apply toggle sequence
          for (const enabled of toggleSequence) {
            await manager.updateGroupSyncSettings(groupName, {
              enabled,
              lastSynced: Date.now(),
            });
          }

          // Final state should match last toggle
          const finalEnabled = toggleSequence[toggleSequence.length - 1];
          const settings = await manager.getGroupSyncSettings(groupName);
          expect(settings.enabled).toBe(finalEnabled);

          // Verify persistence by creating new instance
          const manager2 = new StorageManager();
          await manager2.initialize();
          const restoredSettings = await manager2.getGroupSyncSettings(groupName);
          expect(restoredSettings.enabled).toBe(finalEnabled);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle concurrent preference updates correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 50 }).filter(s => 
              s.trim().length > 0 && 
              s !== '__proto__' && 
              s !== 'constructor' && 
              s !== 'prototype'
            ),
            syncEnabled: fc.boolean(),
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (groups) => {
          const manager = new StorageManager();
          await manager.initialize();

          // Update all groups concurrently
          await Promise.all(
            groups.map(group =>
              manager.updateGroupSyncSettings(group.name, {
                enabled: group.syncEnabled,
                lastSynced: Date.now(),
              })
            )
          );

          // Verify all preferences were saved correctly
          for (const group of groups) {
            const settings = await manager.getGroupSyncSettings(group.name);
            expect(settings.enabled).toBe(group.syncEnabled);
          }

          // Verify persistence
          const manager2 = new StorageManager();
          await manager2.initialize();
          for (const group of groups) {
            const settings = await manager2.getGroupSyncSettings(group.name);
            expect(settings.enabled).toBe(group.syncEnabled);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
