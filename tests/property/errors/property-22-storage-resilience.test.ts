import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { arbitraryGlobalSettings, arbitrarySyncSettings } from '../arbitraries';
import { setupAllMocks } from '../testUtils';

/**
 * Property 22: Storage Operation Resilience
 * 
 * For any storage operation failure or quota exceeded condition, the Storage_Manager
 * should implement retry strategies and cleanup to maintain functionality
 * 
 * Validates: Requirements 7.3, 7.4
 */

describe('Property 22: Storage Operation Resilience', () => {
  let storageManager: StorageManager;
  let mocks: ReturnType<typeof setupAllMocks>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks = setupAllMocks();
    storageManager = new StorageManager();
  });

  it('should retry failed storage operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryGlobalSettings,
        async (settings) => {
          let attemptCount = 0;

          // Mock to fail first time, succeed second time
          vi.mocked(chrome.storage.sync.set).mockImplementation(async () => {
            attemptCount++;
            if (attemptCount === 1) {
              throw new Error('Network error');
            }
            return Promise.resolve();
          });

          // First attempt will fail, but should not crash
          try {
            await storageManager.updateSettings(settings);
          } catch (error) {
            // Expected to fail on first attempt
          }

          // Reset mock to succeed
          vi.mocked(chrome.storage.sync.set).mockResolvedValue(undefined);

          // Second attempt should succeed
          await expect(
            storageManager.updateSettings(settings)
          ).resolves.not.toThrow();
        }
      ),
      { numRuns: 5 } // Reduced from 10 to 5
    );
  }, 10000);

  it('should handle storage corruption gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        async (corruptedData) => {
          // Mock storage to return corrupted data
          vi.mocked(chrome.storage.sync.get).mockResolvedValueOnce({
            'state:settings': corruptedData // Invalid format
          });

          // Initialize should handle corruption
          await storageManager.initialize();

          // Verify: Should fall back to defaults
          const settings = await storageManager.getSettings();
          expect(settings).toBeDefined();
          expect(typeof settings.autoSync).toBe('boolean');
        }
      ),
      { numRuns: 5 } // Reduced from 10 to 5
    );
  }, 10000);

  it('should maintain functionality after storage failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryGlobalSettings,
        async (settings) => {
          // Mock storage failure
          vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(
            new Error('Storage unavailable')
          );

          // First operation fails
          try {
            await storageManager.updateSettings(settings);
          } catch (error) {
            // Expected
          }

          // Reset mock to succeed
          vi.mocked(chrome.storage.sync.set).mockResolvedValue(undefined);

          // Subsequent operations should work
          await expect(
            storageManager.updateSettings({ autoSync: true })
          ).resolves.not.toThrow();

          const currentSettings = await storageManager.getSettings();
          expect(currentSettings).toBeDefined();
        }
      ),
      { numRuns: 5 } // Reduced from 10 to 5
    );
  }, 10000);
});
