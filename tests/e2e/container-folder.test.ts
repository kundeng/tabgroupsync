import { test, expect } from './fixtures';
import { 
  setupExtensionViaUI,
  createTabGroup,
  findBookmarkFolder,
  waitForBookmarkFolder,
  getBookmarksInFolder,
  deleteBookmarkFolder,
  waitForGroupBookmarks,
  waitForSyncComplete,
} from './utils';

/**
 * E2E Test: Container Folder Management
 * 
 * Tests container folder creation, validation, and recovery:
 * - Container folder creation with subfolders
 * - Automatic folder recreation when deleted
 * - Folder structure validation
 * 
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 * 
 * NOTE: All setup is done through the popup UI. No direct storage manipulation.
 * See design.md "E2E Testing Constraints".
 */

test.describe('Container Folder Management E2E', () => {
  test('should create container folder with proper subfolder structure', async ({ extensionPage, extensionId }) => {
    // Set up extension via UI — this selects a container folder and enables auto-sync
    const containerName = await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'My Tab Groups',
      enableAutoSync: true,
    });

    // Create a tab group to trigger folder structure creation
    await createTabGroup(extensionPage, {
      title: 'Test Group',
      color: 'blue',
      urls: ['https://example.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Test Group', 1);

    // Verify container folder has the correct subfolders
    const container = await findBookmarkFolder(extensionPage, containerName);
    expect(container).toBeTruthy();

    const children = await getBookmarksInFolder(extensionPage, container!.id);
    const bookmarksFolder = children.find(c => c.title === 'Tab Group Bookmarks' && !c.url);
    const snapshotsFolder = children.find(c => c.title === 'Tab Group Snapshots' && !c.url);

    expect(bookmarksFolder).toBeTruthy();
    expect(snapshotsFolder).toBeTruthy();

    // Verify the group folder is inside the bookmarks folder
    if (bookmarksFolder) {
      const groupFolders = await getBookmarksInFolder(extensionPage, bookmarksFolder.id);
      const testGroupFolder = groupFolders.find(f => f.title === 'Test Group');
      expect(testGroupFolder).toBeTruthy();
    }
  });

  test('should automatically recreate container folder when deleted', async ({ extensionPage, extensionId }) => {
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Tab Groups Container',
      enableAutoSync: true,
    });

    // Create a tab group so the extension has something to sync
    await createTabGroup(extensionPage, {
      title: 'Important Group',
      color: 'red',
      urls: ['https://example.com', 'https://google.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Important Group', 2);

    // Verify folder exists
    let container = await findBookmarkFolder(extensionPage, 'Tab Groups Container');
    expect(container).toBeTruthy();

    // Delete the container folder (simulates external action)
    await deleteBookmarkFolder(extensionPage, container!.id);

    // Wait for automatic recreation
    await extensionPage.waitForTimeout(5000);

    // Verify folder was recreated
    container = await findBookmarkFolder(extensionPage, 'Tab Groups Container');
    expect(container).toBeTruthy();

    // Verify it has the proper structure
    if (container) {
      const children = await getBookmarksInFolder(extensionPage, container.id);
      const bookmarksFolder = children.find(c => c.title === 'Tab Group Bookmarks');
      const snapshotsFolder = children.find(c => c.title === 'Tab Group Snapshots');

      expect(bookmarksFolder).toBeTruthy();
      expect(snapshotsFolder).toBeTruthy();
    }
  });

  test('should handle container folder in different bookmark locations', async ({ extensionPage, extensionId }) => {
    // Create a folder in "Other Bookmarks" before setup (browser-level action)
    await extensionPage.evaluate(async () => {
      const existing = await chrome.bookmarks.search({ title: 'Tab Groups in Other' });
      if (!existing.find(b => !b.url)) {
        await chrome.bookmarks.create({ parentId: '2', title: 'Tab Groups in Other' });
      }
    });

    // Set up extension via UI pointing to that folder
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Tab Groups in Other',
      enableAutoSync: true,
    });

    // Create a tab group
    await createTabGroup(extensionPage, {
      title: 'Other Location Test',
      color: 'cyan',
      urls: ['https://example.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Other Location Test', 1);

    // Verify folder structure was created correctly
    const container = await findBookmarkFolder(extensionPage, 'Tab Groups in Other');
    expect(container).toBeTruthy();

    if (container) {
      const children = await getBookmarksInFolder(extensionPage, container.id);
      const bookmarksFolder = children.find(c => c.title === 'Tab Group Bookmarks');
      expect(bookmarksFolder).toBeTruthy();

      if (bookmarksFolder) {
        const groupFolders = await getBookmarksInFolder(extensionPage, bookmarksFolder.id);
        const testFolder = groupFolders.find(f => f.title === 'Other Location Test');
        expect(testFolder).toBeTruthy();
      }
    }
  });

  test('should not recreate container when no tab groups exist', async ({ extensionPage, extensionId }) => {
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Empty Container',
      enableAutoSync: true,
    });

    // Find and delete the container folder (without any tab groups existing)
    const container = await findBookmarkFolder(extensionPage, 'Empty Container');
    expect(container).toBeTruthy();
    await deleteBookmarkFolder(extensionPage, container!.id);

    // Wait to see if it gets recreated
    await extensionPage.waitForTimeout(3000);

    // Verify folder was NOT recreated (no tab groups exist)
    const folder = await findBookmarkFolder(extensionPage, 'Empty Container');
    expect(folder).toBeNull();
  });
});
