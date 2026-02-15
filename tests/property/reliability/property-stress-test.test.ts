import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { StorageManager } from '../../../src/lib/storage/storageManager';

/**
 * Property 6: Reliability Stress Test
 * 
 * Generate random sequences of sync events (settings changes, history entries,
 * mapping updates, folder resolution) and verify:
 * - No unhandled exceptions
 * - State remains consistent after all operations
 * - No silent data loss (settings preserved, history entries accumulated)
 * 
 * Validates: NF 3 (Chaos/stress testing)
 */

// Event types for the stress test
type StressEvent =
  | { type: 'updateSettings'; autoSync: boolean; keepRemoved: boolean }
  | { type: 'addHistory'; groupName: string; success: boolean; persist: boolean }
  | { type: 'updateMapping'; groupName: string; syncEnabled: boolean }
  | { type: 'resolveFolder' }
  | { type: 'getSettings' }
  | { type: 'getHistory' }
  | { type: 'getAllMappings' };

// Arbitrary for generating random stress events
const stressEventArb: fc.Arbitrary<StressEvent> = fc.oneof(
  fc.record({
    type: fc.constant('updateSettings' as const),
    autoSync: fc.boolean(),
    keepRemoved: fc.boolean()
  }),
  fc.record({
    type: fc.constant('addHistory' as const),
    groupName: fc.string({ minLength: 1, maxLength: 15 }),
    success: fc.boolean(),
    persist: fc.boolean()
  }),
  fc.record({
    type: fc.constant('updateMapping' as const),
    groupName: fc.string({ minLength: 1, maxLength: 15 }),
    syncEnabled: fc.boolean()
  }),
  fc.record({ type: fc.constant('resolveFolder' as const) }),
  fc.record({ type: fc.constant('getSettings' as const) }),
  fc.record({ type: fc.constant('getHistory' as const) }),
  fc.record({ type: fc.constant('getAllMappings' as const) })
);

describe('Feature: sw-reliability, Property 6: Reliability Stress Test', () => {
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

    // Default bookmark mocks — folder exists
    vi.mocked(chrome.bookmarks.get).mockImplementation(((id: any) => {
      if (id === 'container-1') {
        return Promise.resolve([{
          id: 'container-1', title: 'Tab Groups', parentId: '0',
          index: 0, dateAdded: Date.now()
        }]);
      }
      return Promise.resolve([]);
    }) as any);

    vi.mocked(chrome.bookmarks.search).mockImplementation((() => {
      return Promise.resolve([]);
    }) as any);

    vi.mocked(chrome.bookmarks.getChildren).mockImplementation(((id: any) => {
      if (id === 'container-1') {
        return Promise.resolve([
          { id: 'bm-1', title: 'Tab Group Bookmarks', parentId: 'container-1', index: 0, dateAdded: Date.now() },
          { id: 'sn-1', title: 'Tab Group Snapshots', parentId: 'container-1', index: 1, dateAdded: Date.now() },
        ]);
      }
      return Promise.resolve([]);
    }) as any);
  });

  it('should survive random sequences of operations without exceptions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(stressEventArb, { minLength: 5, maxLength: 30 }),
        async (events) => {
          // Initialize with a valid container folder
          storageData = {
            'state:settings': {
              autoSync: true,
              containerFolderId: 'container-1',
              containerFolderName: 'Tab Groups',
              keepRemoved: false,
              cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
            }
          };

          const manager = new StorageManager();
          await manager.initialize();

          const errors: string[] = [];
          let historyAdded = 0;
          let mappingsUpdated = 0;

          // Execute random event sequence
          for (const event of events) {
            try {
              switch (event.type) {
                case 'updateSettings':
                  await manager.updateSettings({
                    autoSync: event.autoSync,
                    keepRemoved: event.keepRemoved
                  });
                  break;

                case 'addHistory':
                  await manager.addHistoryEntry({
                    timestamp: Date.now(),
                    type: 'group-to-folder',
                    groupId: `group:${event.groupName}`,
                    folderId: 'folder-1',
                    success: event.success,
                    details: event.persist ? 'tabs synced' : 'Synced, no changes'
                  }, { persistToStorage: event.persist });
                  historyAdded++;
                  break;

                case 'updateMapping':
                  await manager.updateMapping(event.groupName, {
                    syncEnabled: event.syncEnabled,
                    status: { lastSynced: Date.now(), inProgress: false }
                  });
                  mappingsUpdated++;
                  break;

                case 'resolveFolder':
                  await manager.resolveContainerFolder();
                  break;

                case 'getSettings':
                  await manager.getSettings();
                  break;

                case 'getHistory':
                  await manager.getHistory();
                  break;

                case 'getAllMappings':
                  await manager.getAllMappings();
                  break;
              }
            } catch (error) {
              errors.push(`${event.type}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          // Invariants after stress test:
          // 1. No unhandled exceptions (errors array should be empty or contain only expected errors)
          // Quota errors are acceptable; other errors are not
          const unexpectedErrors = errors.filter(e => !e.includes('quota') && !e.includes('exceeded'));
          expect(unexpectedErrors).toEqual([]);

          // 2. Settings should be readable
          const settings = await manager.getSettings();
          expect(settings).toBeDefined();
          expect(typeof settings.autoSync).toBe('boolean');
          expect(typeof settings.keepRemoved).toBe('boolean');

          // 3. History should contain entries (up to 50 cap)
          const history = await manager.getHistory();
          expect(history.length).toBeLessThanOrEqual(50);
          if (historyAdded > 0) {
            expect(history.length).toBeGreaterThan(0);
          }

          // 4. Container folder should still be resolvable
          const resolution = await manager.resolveContainerFolder();
          expect(['exists', 'relocated', 'deleted', 'unverified']).toContain(resolution);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should handle concurrent read/write operations without corruption', async () => {
    storageData = {
      'state:settings': {
        autoSync: true,
        containerFolderId: 'container-1',
        containerFolderName: 'Tab Groups',
        keepRemoved: false,
        cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
      }
    };

    const manager = new StorageManager();
    await manager.initialize();

    // Fire many concurrent operations
    const operations = Array.from({ length: 20 }, (_, i) => {
      if (i % 4 === 0) return manager.getSettings();
      if (i % 4 === 1) return manager.getHistory();
      if (i % 4 === 2) return manager.getAllMappings();
      return manager.addHistoryEntry({
        timestamp: Date.now() + i,
        type: 'group-to-folder',
        groupId: `group:concurrent-${i}`,
        folderId: 'folder-1',
        success: true,
        details: 'concurrent test'
      }, { persistToStorage: i % 2 === 0 });
    });

    // All operations should complete without throwing
    await expect(Promise.all(operations)).resolves.toBeDefined();

    // State should be consistent
    const settings = await manager.getSettings();
    expect(settings.containerFolderId).toBe('container-1');
    const history = await manager.getHistory();
    expect(history.length).toBeGreaterThan(0);
  });

  it('should maintain history cap at 50 entries under heavy load', async () => {
    storageData = {
      'state:settings': {
        autoSync: true,
        keepRemoved: false,
        cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: false, deleteThreshold: 90 }
      }
    };

    const manager = new StorageManager();
    await manager.initialize();

    // Add 100 history entries
    for (let i = 0; i < 100; i++) {
      await manager.addHistoryEntry({
        timestamp: Date.now() + i,
        type: 'group-to-folder',
        groupId: `group:stress-${i}`,
        folderId: 'folder-1',
        success: true,
        details: `entry ${i}`
      }, { persistToStorage: false });
    }

    const history = await manager.getHistory();
    expect(history.length).toBe(50);
    // Most recent entry should be last added
    expect(history[0].details).toBe('entry 99');
  });
});
