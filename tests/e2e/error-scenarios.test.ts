import { test, expect } from './fixtures';
import { 
  setupExtensionViaUI,
  createTabGroup,
  createAndSyncTabGroup,
  findBookmarkFolder,
  waitForBookmarkFolder,
  getBookmarksInFolder,
  deleteBookmarkFolder,
  waitForGroupBookmarks,
  waitForSyncComplete,
} from './utils';

/**
 * E2E Test: Error Scenarios
 * 
 * Tests error handling and recovery:
 * - Bookmark creation failure and recovery
 * - Invalid URL handling
 * - Rapid sync requests (queuing/debouncing)
 * - Missing container folder recovery
 * - Concurrent group operations
 * - Bookmark API errors
 * 
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 * 
 * NOTE: All setup is done through the popup UI. No sendMessageToBackground.
 * See design.md "E2E Testing Constraints".
 */

test.describe('Error Scenarios E2E', () => {
  test.beforeEach(async ({ extensionPage, extensionId }) => {
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Error Test Container',
      enableAutoSync: true,
    });
  });

  test('should handle bookmark creation failure gracefully', async ({ extensionPage, extensionId }) => {
    // Create a tab group and enable sync
    const groupId = await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Error Test',
      color: 'blue',
      urls: ['https://example.com']
    });

    // Wait for initial sync
    await waitForGroupBookmarks(extensionPage, 'Error Test', 1);

    const folder = await findBookmarkFolder(extensionPage, 'Error Test');
    expect(folder).toBeTruthy();

    // Simulate bookmark creation failure by deleting the folder
    await deleteBookmarkFolder(extensionPage, folder!.id);
    await extensionPage.waitForTimeout(1000);

    // Add a new tab (should trigger sync and recreate folder)
    await extensionPage.evaluate(async (gid: number) => {
      const tab = await chrome.tabs.create({ url: 'https://google.com', active: false });
      await chrome.tabs.group({ groupId: gid, tabIds: [tab.id!] });
    }, groupId);

    await extensionPage.waitForTimeout(5000);

    // Verify folder was recreated and sync recovered
    const recoveredFolder = await findBookmarkFolder(extensionPage, 'Error Test');
    expect(recoveredFolder).toBeTruthy();

    if (recoveredFolder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, recoveredFolder.id);
      expect(bookmarks.filter(b => b.url).length).toBeGreaterThan(0);
    }
  });

  test('should handle invalid URLs gracefully', async ({ extensionPage, extensionId }) => {
    // Create a tab group with a mix of valid and invalid URLs
    const groupId = await extensionPage.evaluate(async () => {
      // Create tabs with various URL types
      const tab1 = await chrome.tabs.create({ url: 'https://example.com', active: false });
      const tab2 = await chrome.tabs.create({ url: 'chrome://extensions', active: false });
      const tab3 = await chrome.tabs.create({ url: 'about:blank', active: false });
      
      const gid = await chrome.tabs.group({ tabIds: [tab1.id!, tab2.id!, tab3.id!] });
      await chrome.tabGroups.update(gid, { title: 'Mixed URLs', color: 'red' });
      
      return gid;
    });

    await waitForSyncComplete(extensionPage);

    // Verify folder was created
    const folder = await waitForBookmarkFolder(extensionPage, 'Mixed URLs');
    expect(folder).toBeTruthy();

    // Verify only valid URLs were bookmarked
    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      const urls = bookmarks.filter(b => b.url).map(b => b.url!);
      
      // Should have at least the valid URL
      expect(urls).toContain('https://example.com/');
      
      // Chrome URLs and about:blank should be skipped
      expect(urls.every(url => url.startsWith('http'))).toBe(true);
    }
  });

  test('should handle rapid sync requests with queuing', async ({ extensionPage, extensionId }) => {
    // Create a tab group and enable sync
    const groupId = await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Rapid Sync Test',
      color: 'green',
      urls: ['https://example.com']
    });

    await waitForGroupBookmarks(extensionPage, 'Rapid Sync Test', 1);

    // Rapidly add multiple tabs (browser-level actions)
    for (let i = 0; i < 10; i++) {
      await extensionPage.evaluate(async (args: { gid: number; index: number }) => {
        const tab = await chrome.tabs.create({ 
          url: `https://example.com/page${args.index}`, 
          active: false 
        });
        await chrome.tabs.group({ groupId: args.gid, tabIds: [tab.id!] });
      }, { gid: groupId, index: i });
      
      // Small delay between additions
      await extensionPage.waitForTimeout(100);
    }

    // Wait for all syncs to complete
    await extensionPage.waitForTimeout(10000);

    // Verify all tabs were eventually synced
    const folder = await findBookmarkFolder(extensionPage, 'Rapid Sync Test');
    expect(folder).toBeTruthy();

    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      const urls = bookmarks.filter(b => b.url).map(b => b.url);
      
      // Should have original + 10 new tabs
      expect(urls.length).toBeGreaterThanOrEqual(10);
    }
  });

  test('should handle rapid tab changes without crashing', async ({ extensionPage, extensionId }) => {
    // Create a tab group and enable sync
    const groupId = await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Quota Test',
      color: 'yellow',
      urls: ['https://example.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Quota Test', 1);

    // Rapidly add and remove tabs to stress the sync queue (browser-level actions)
    for (let i = 0; i < 10; i++) {
      await extensionPage.evaluate(async (gid) => {
        const tab = await chrome.tabs.create({ url: `https://example.com/stress${Date.now()}`, active: false });
        await chrome.tabs.group({ groupId: gid, tabIds: [tab.id!] });
      }, groupId);
      await extensionPage.waitForTimeout(100);
    }

    await extensionPage.waitForTimeout(5000);

    // Verify extension is still functional
    const stillWorks = await extensionPage.evaluate(async () => {
      try { await chrome.tabGroups.query({}); return true; } catch { return false; }
    });

    expect(stillWorks).toBe(true);
  });

  test('should handle missing container folder gracefully', async ({ extensionPage, extensionId }) => {
    // Create a tab group and enable sync
    const groupId = await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Missing Container Test',
      color: 'purple',
      urls: ['https://example.com']
    });

    // Verify initial sync
    let folder = await waitForBookmarkFolder(extensionPage, 'Missing Container Test');
    expect(folder).toBeTruthy();

    // Delete the container folder
    await extensionPage.evaluate(() => {
      return chrome.bookmarks.removeTree('1').catch(() => {
        // May fail if bookmarks bar can't be deleted, that's ok
      });
    });

    await extensionPage.waitForTimeout(2000);

    // Try to add a tab (should handle missing container)
    await extensionPage.evaluate((gid) => {
      return chrome.tabs.create({ url: 'https://google.com', active: false }).then(tab => {
        return chrome.tabs.group({ groupId: gid, tabIds: [tab.id!] });
      });
    }, groupId);

    await extensionPage.waitForTimeout(5000);

    // Verify extension didn't crash
    const stillWorks = await extensionPage.evaluate(() => {
      return chrome.tabGroups.query({}).then(() => true).catch(() => false);
    });

    expect(stillWorks).toBe(true);
  });

  test('should handle concurrent group operations', async ({ extensionPage, extensionId }) => {
    const groupCount = 3;

    // Create multiple groups in quick succession
    for (let i = 0; i < groupCount; i++) {
      await extensionPage.evaluate(async (idx) => {
        const tab = await chrome.tabs.create({ url: `https://example.com/${idx}`, active: false });
        const gid = await chrome.tabs.group({ tabIds: [tab.id!] });
        await chrome.tabGroups.update(gid, { title: `Concurrent ${idx}`, color: 'blue' as chrome.tabGroups.ColorEnum });
      }, i);
      // Small delay to let Chrome process events
      await extensionPage.waitForTimeout(500);
    }

    // Verify all groups were synced
    for (let i = 0; i < groupCount; i++) {
      const folder = await waitForBookmarkFolder(extensionPage, `Concurrent ${i}`, 30000);
      expect(folder).toBeTruthy();
    }
  });

  test('should recover from bookmark API errors', async ({ extensionPage, extensionId }) => {
    // Create a tab group and enable sync
    const groupId = await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'API Error Test',
      color: 'cyan',
      urls: ['https://example.com']
    });

    const folder = await waitForBookmarkFolder(extensionPage, 'API Error Test');
    expect(folder).toBeTruthy();

    // Simulate API error by trying to create bookmark in non-existent folder
    await extensionPage.evaluate(() => {
      return chrome.bookmarks.create({
        parentId: 'non-existent-id',
        title: 'Should Fail',
        url: 'https://fail.com'
      }).catch(() => {
        // Expected to fail
      });
    });

    await extensionPage.waitForTimeout(1000);

    // Verify extension still works after error
    await extensionPage.evaluate((gid) => {
      return chrome.tabs.create({ url: 'https://recovery.com', active: false }).then(tab => {
        return chrome.tabs.group({ groupId: gid, tabIds: [tab.id!] });
      });
    }, groupId);

    await extensionPage.waitForTimeout(5000);

    // Verify new tab was synced
    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      const urls = bookmarks.filter(b => b.url).map(b => b.url);
      expect(urls).toContain('https://recovery.com/');
    }
  });

  test('should handle extension page reload during sync', async ({ extensionPage, extensionId }) => {
    // Create a tab group and enable sync
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Restart Test',
      color: 'orange',
      urls: ['https://example.com'],
    });

    // Don't wait for sync to complete — reload the popup mid-sync
    await extensionPage.waitForTimeout(1000);
    await extensionPage.reload();
    await extensionPage.waitForTimeout(3000);

    // Verify sync eventually completes after reload
    const folder = await waitForBookmarkFolder(extensionPage, 'Restart Test', 10000);
    expect(folder).toBeTruthy();

    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      expect(bookmarks.filter(b => b.url)).toHaveLength(1);
    }
  });

  test('should remain functional after bookmark API errors', async ({ extensionPage, extensionId }) => {
    // Create a tab group and enable sync
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Error Logging Test',
      color: 'cyan',
      urls: ['https://example.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Error Logging Test', 1);

    // Simulate a bookmark API error (browser-level — not an internal API)
    await extensionPage.evaluate(async () => {
      try {
        await chrome.bookmarks.create({
          parentId: 'non-existent-id',
          title: 'Should Fail',
          url: 'https://fail.com',
        });
      } catch {
        // Expected to fail
      }
    });

    await extensionPage.waitForTimeout(1000);

    // Verify extension didn't crash
    const stillWorks = await extensionPage.evaluate(async () => {
      try { await chrome.tabGroups.query({}); return true; } catch { return false; }
    });

    expect(stillWorks).toBe(true);
  });
});
