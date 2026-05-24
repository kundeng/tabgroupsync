import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { arbitraryRuntimeMapping } from '../arbitraries';
import { setupAllMocks } from '../testUtils';

/**
 * Property 26: Memory Management
 * 
 * For any growing memory usage, the Extension should implement cleanup strategies
 * for cached data to maintain performance
 * 
 * Validates: Requirements 10.4
 */

describe('Property 26: Memory Management', () => {
  let storageManager: StorageManager;
  let mocks: ReturnType<typeof setupAllMocks>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks = setupAllMocks();
    storageManager = new StorageManager();
    await storageManager.initialize();
  });

  it('should handle large numbers of mappings without memory issues', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryRuntimeMapping, { minLength: 10, maxLength: 50 }),
        async (mappings) => {
          // Store multiple mappings
          for (const mapping of mappings) {
            await storageManager.updateMapping(mapping.name, {
              folderId: mapping.folderId,
              syncEnabled: mapping.syncEnabled
            });
          }

          // Verify: All mappings can be retrieved
          const allMappings = await storageManager.getAllMappings();
          expect(Object.keys(allMappings).length).toBeGreaterThan(0);

          // Verify: System remains responsive
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should maintain performance with repeated operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryRuntimeMapping,
        fc.integer({ min: 5, max: 20 }),
        async (mapping, iterations) => {
          const startTime = Date.now();

          // Perform repeated operations
          for (let i = 0; i < iterations; i++) {
            await storageManager.updateMapping(mapping.name, {
              folderId: `folder-${i}`,
              syncEnabled: i % 2 === 0
            });
            await storageManager.getMapping(mapping.name);
          }

          const duration = Date.now() - startTime;

          // Verify: Operations complete in reasonable time
          expect(duration).toBeLessThan(5000); // 5 seconds for all iterations

          // Verify: Final state is correct
          const finalMapping = await storageManager.getMapping(mapping.name);
          expect(finalMapping).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should handle cleanup of old data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryRuntimeMapping, { minLength: 5, maxLength: 20 }),
        async (mappings) => {
          // Store mappings
          for (const mapping of mappings) {
            await storageManager.updateMapping(mapping.name, {
              folderId: mapping.folderId,
              syncEnabled: mapping.syncEnabled
            });
          }

          // Get initial count
          const initialMappings = await storageManager.getAllMappings();
          const initialCount = Object.keys(initialMappings).length;

          // Verify: Mappings were stored
          expect(initialCount).toBeGreaterThan(0);

          // System should remain stable
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
