import { test, expect } from './fixtures';
import { 
  setupExtensionViaUI,
  openExtensionPopup,
  createTabGroup,
  toggleGroupSync,
  findBookmarkFolder,
  waitForBookmarkFolder,
  getBookmarksInFolder,
  waitForGroupBookmarks,
  waitForSyncComplete,
} from './utils';

/**
 * E2E Test: Sync Control
 * 
 * Tests sync control functionality:
 * - Toggling sync on and off via popup UI
 * - Auto-sync for new groups
 * - Auto-sync preconditions (container folder required)
 * - Independent sync control per group
 * 
 * Validates: Requirements 3.1, 3.2, 3.3, 6.1, 6.2, 6.3
 * 
 * NOTE: All actions are done through the popup UI. No sendMessageToBackground.
 * See design.md "E2E Testing Constraints".
 */

test.describe('Sync Control E2E', () => {
  test('should toggle sync on and off for individual groups', async ({ extensionPage, extensionId }) => {
    // Set up with auto-sync DISABLED so groups don't auto-sync
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Sync Control Container',
      enableAutoSync: false,
    });

    // Create a tab group
    const groupId = await createTabGroup(extensionPage, {
      title: 'Toggle Test',
      color: 'blue',
      urls: ['https://example.com'],
    });

    await extensionPage.waitForTimeout(3000);

    // Verify no bookmark folder created (auto-sync off)
    let folder = await findBookmarkFolder(extensionPage, 'Toggle Test');
    expect(folder).toBeNull();

    // Enable sync for this group via popup UI (click the switch)
    await toggleGroupSync(extensionPage, extensionId, 'Toggle Test');

    // Wait for sync to happen
    folder = await waitForBookmarkFolder(extensionPage, 'Toggle Test', 10000);
    expect(folder).toBeTruthy();

    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      expect(bookmarks.filter(b => b.url)).toHaveLength(1);
    }

    // Disable sync via popup UI (click the switch again)
    await toggleGroupSync(extensionPage, extensionId, 'Toggle Test');
    await extensionPage.waitForTimeout(1000);

    // Add a new tab to the group (browser-level action)
    await extensionPage.evaluate(async (gid) => {
      const tab = await chrome.tabs.create({ url: 'https://github.com', active: false });
      await chrome.tabs.group({ groupId: gid, tabIds: [tab.id!] });
    }, groupId);

    await extensionPage.waitForTimeout(3000);

    // Verify new tab was NOT synced (sync is off)
    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      expect(bookmarks.filter(b => b.url)).toHaveLength(1); // Still only 1
    }
  });

  test('should auto-sync new groups when auto-sync is enabled', async ({ extensionPage, extensionId }) => {
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Auto Sync Container',
      enableAutoSync: true,
    });

    // Create a tab group — should auto-sync
    await createTabGroup(extensionPage, {
      title: 'Auto Sync Test',
      color: 'green',
      urls: ['https://example.com', 'https://google.com'],
    });

    // Verify bookmark folder was automatically created
    await waitForGroupBookmarks(extensionPage, 'Auto Sync Test', 2);

    const folder = await findBookmarkFolder(extensionPage, 'Auto Sync Test');
    expect(folder).toBeTruthy();
  });

  test('should not auto-sync when auto-sync is disabled', async ({ extensionPage, extensionId }) => {
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'No Auto Sync Container',
      enableAutoSync: false,
    });

    // Create a tab group
    await createTabGroup(extensionPage, {
      title: 'No Auto Sync',
      color: 'yellow',
      urls: ['https://example.com'],
    });

    await extensionPage.waitForTimeout(5000);

    // Verify no bookmark folder was created
    const folder = await findBookmarkFolder(extensionPage, 'No Auto Sync');
    expect(folder).toBeNull();
  });

  test('should sync multiple groups independently', async ({ extensionPage, extensionId }) => {
    // Set up with auto-sync disabled
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Independent Sync Container',
      enableAutoSync: false,
    });

    // Create two tab groups
    await createTabGroup(extensionPage, {
      title: 'Group A',
      color: 'blue',
      urls: ['https://example.com'],
    });

    await createTabGroup(extensionPage, {
      title: 'Group B',
      color: 'red',
      urls: ['https://google.com'],
    });

    await extensionPage.waitForTimeout(2000);

    // Enable sync only for Group A via popup UI
    await toggleGroupSync(extensionPage, extensionId, 'Group A');

    // Verify Group A has bookmarks
    const folderA = await waitForBookmarkFolder(extensionPage, 'Group A', 10000);
    expect(folderA).toBeTruthy();

    // Verify Group B does NOT have bookmarks
    const folderB = await findBookmarkFolder(extensionPage, 'Group B');
    expect(folderB).toBeNull();

    // Now enable sync for Group B via popup UI
    await toggleGroupSync(extensionPage, extensionId, 'Group B');

    // Verify Group B now has bookmarks
    const folderB2 = await waitForBookmarkFolder(extensionPage, 'Group B', 10000);
    expect(folderB2).toBeTruthy();
  });
});
