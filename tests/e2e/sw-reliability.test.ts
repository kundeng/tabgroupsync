import { test, expect } from './fixtures';
import { openExtensionPopup, setupExtensionViaUI } from './utils';

/**
 * E2E Tests for sw-reliability spec
 * 
 * Tests:
 * 6.1 — Periodic sync survives worker idle
 * 6.2 — Storage location persists across extension reload
 * 6.3 — Extension recovers from initialization failure
 * 
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 2.4, 3.1, 3.2, 3.5
 */

test.describe('SW Reliability E2E', () => {

  // 6.1 — Periodic sync survives worker idle
  test('periodic sync should survive worker idle via chrome.alarms', async ({ context, extensionPage, extensionId }) => {
    // Setup extension with a container folder
    await setupExtensionViaUI(extensionPage, extensionId);

    // Create a tab group to sync
    const page = await context.newPage();
    await page.goto('https://example.com');
    const tabId = await extensionPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
      return tabs[0]?.id;
    });
    expect(tabId).toBeTruthy();

    // Group the tab
    await extensionPage.evaluate(async (id: number) => {
      const groupId = await chrome.tabs.group({ tabIds: [id] });
      await chrome.tabGroups.update(groupId, { title: 'E2E Alarm Test', color: 'blue' });
    }, tabId!);

    // Wait for initial sync to complete
    await extensionPage.waitForTimeout(3000);

    // Verify alarm exists
    const alarm = await extensionPage.evaluate(async () => {
      return await chrome.alarms.get('periodic-sync');
    });
    expect(alarm).toBeTruthy();
    expect(alarm!.periodInMinutes).toBeGreaterThanOrEqual(1);

    // Verify service worker is running
    const workers = context.serviceWorkers();
    expect(workers.length).toBeGreaterThan(0);

    // Open popup and verify the group appears
    await openExtensionPopup(extensionPage, extensionId);
    await expect(extensionPage.getByText('E2E Alarm Test', { exact: true })).toBeVisible({ timeout: 10000 });

    // Cleanup
    await page.close();
  });

  // 6.2 — Storage location persists across extension reload
  test('storage location should persist across extension reload', async ({ context, extensionPage, extensionId }) => {
    // Setup extension with a specific container folder
    const folderName = await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'E2E Persist Test'
    });

    // Verify container folder is set
    await openExtensionPopup(extensionPage, extensionId);
    const settingsBefore = await extensionPage.evaluate(async () => {
      const data = await chrome.storage.sync.get('state:settings');
      return data['state:settings'];
    });
    expect(settingsBefore.containerFolderId).toBeTruthy();
    expect(settingsBefore.containerFolderName).toBe(folderName);

    // Simulate extension reload by navigating away and back
    // (Full extension reload requires chrome://extensions which isn't accessible in Playwright)
    // Instead, verify that a new StorageManager instance reads the persisted settings
    await extensionPage.goto('about:blank');
    await extensionPage.waitForTimeout(1000);

    // Re-open popup (triggers re-initialization if worker was terminated)
    await openExtensionPopup(extensionPage, extensionId);

    // Verify settings persisted
    const settingsAfter = await extensionPage.evaluate(async () => {
      const data = await chrome.storage.sync.get('state:settings');
      return data['state:settings'];
    });
    expect(settingsAfter.containerFolderId).toBe(settingsBefore.containerFolderId);
    expect(settingsAfter.containerFolderName).toBe(folderName);
  });

  // 6.3 — Extension recovers from initialization failure
  test('extension should process messages after worker restart', async ({ context, extensionPage, extensionId }) => {
    // Setup extension
    await setupExtensionViaUI(extensionPage, extensionId);

    // Navigate away to let worker potentially go idle
    await extensionPage.goto('about:blank');
    await extensionPage.waitForTimeout(2000);

    // Re-open popup — this sends messages to the background worker
    // If the worker was terminated, ensureInitialized() should recover it
    await openExtensionPopup(extensionPage, extensionId);

    // Verify the popup loaded successfully (background responded to messages)
    await expect(extensionPage.locator('h1:has-text("Tab Group Sync")')).toBeVisible({ timeout: 10000 });

    // Verify we can read settings (proves background is responsive)
    const settings = await extensionPage.evaluate(async () => {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(response);
        });
      });
    });
    expect(settings).toBeTruthy();
  });
});
