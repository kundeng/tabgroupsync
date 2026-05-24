import { test, expect } from './fixtures';
import { 
  setupExtensionViaUI,
  createTabGroup,
  createAndSyncTabGroup,
  findBookmarkFolder,
  waitForBookmarkFolder,
  getBookmarksInFolder,
  waitForGroupBookmarks,
  waitForSyncComplete,
} from './utils';

/**
 * E2E Test: Cross-Device Sync Simulation
 * 
 * Tests cross-device synchronization via Chrome's bookmark sync.
 * Simulates remote device actions by directly manipulating bookmarks
 * (acceptable — this is how Chrome sync works, not an internal API).
 * 
 * Validates: Requirements 2.1, 2.2, 2.3
 * 
 * NOTE: All extension setup is done through the popup UI.
 * Bookmark manipulation to simulate remote devices IS acceptable.
 * See design.md "E2E Testing Constraints".
 */

test.describe('Cross-Device Sync E2E', () => {
  test.beforeEach(async ({ extensionPage, extensionId }) => {
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Cross Device Container',
      enableAutoSync: true,
    });
  });

  test('should sync bookmarks created on device A to device B', async ({ extensionPage, extensionId }) => {
    // Device A: Create a tab group and enable sync
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Cross Device Test',
      color: 'blue',
      urls: ['https://example.com', 'https://google.com'],
    });

    // Verify bookmarks created on Device A
    const bookmarks = await waitForGroupBookmarks(extensionPage, 'Cross Device Test', 2);
    expect(bookmarks.filter(b => b.url)).toHaveLength(2);

    // Verify the folder structure is sync-compatible (read-only assertion)
    const folder = await findBookmarkFolder(extensionPage, 'Cross Device Test');
    expect(folder).toBeTruthy();

    if (folder) {
      const bookmarkDetails = await extensionPage.evaluate(async (folderId) => {
        return await chrome.bookmarks.getSubTree(folderId);
      }, folder.id);

      expect(bookmarkDetails).toBeTruthy();
      expect(bookmarkDetails[0].children).toBeDefined();
    }
  });

  test('should handle bookmark changes from remote device', async ({ extensionPage, extensionId }) => {
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Remote Change Test',
      color: 'red',
      urls: ['https://example.com'],
    });

    const folder = await waitForBookmarkFolder(extensionPage, 'Remote Change Test');
    expect(folder).toBeTruthy();

    // Simulate remote device adding a bookmark to the folder
    if (folder) {
      await extensionPage.evaluate(async (folderId) => {
        await chrome.bookmarks.create({
          parentId: folderId,
          title: 'Remote Added',
          url: 'https://remote-device.com',
        });
      }, folder.id);

      await extensionPage.waitForTimeout(2000);

      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      const urls = bookmarks.filter(b => b.url).map(b => b.url);

      expect(urls).toContain('https://example.com/');
      expect(urls).toContain('https://remote-device.com/');
    }
  });

  test('should handle folder rename from remote device', async ({ extensionPage, extensionId }) => {
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Original Remote Name',
      color: 'green',
      urls: ['https://example.com'],
    });

    let folder = await waitForBookmarkFolder(extensionPage, 'Original Remote Name');
    expect(folder).toBeTruthy();

    // Simulate remote device renaming the folder
    if (folder) {
      await extensionPage.evaluate(async (folderId) => {
        await chrome.bookmarks.update(folderId, { title: 'Renamed By Remote' });
      }, folder.id);

      await extensionPage.waitForTimeout(2000);

      const renamedFolder = await findBookmarkFolder(extensionPage, 'Renamed By Remote');
      expect(renamedFolder).toBeTruthy();

      const oldFolder = await findBookmarkFolder(extensionPage, 'Original Remote Name');
      expect(oldFolder).toBeNull();
    }
  });

  test('should handle bookmark deletion from remote device', async ({ extensionPage, extensionId }) => {
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Remote Delete Test',
      color: 'yellow',
      urls: ['https://example.com', 'https://google.com', 'https://github.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Remote Delete Test', 3);

    const folder = await findBookmarkFolder(extensionPage, 'Remote Delete Test');
    expect(folder).toBeTruthy();

    if (folder) {
      let bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      const bookmarkToDelete = bookmarks.find(b => b.url === 'https://google.com/');

      if (bookmarkToDelete) {
        // Simulate remote device deleting a bookmark
        await extensionPage.evaluate(async (bookmarkId) => {
          await chrome.bookmarks.remove(bookmarkId);
        }, bookmarkToDelete.id);

        await extensionPage.waitForTimeout(2000);

        bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
        const urls = bookmarks.filter(b => b.url).map(b => b.url);

        expect(urls).toHaveLength(2);
        expect(urls).not.toContain('https://google.com/');
      }
    }
  });

  test('should handle same group on multiple devices', async ({ extensionPage, extensionId }) => {
    const groupId = await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Multi Device Group',
      color: 'purple',
      urls: ['https://example.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Multi Device Group', 1);

    const folder = await findBookmarkFolder(extensionPage, 'Multi Device Group');
    expect(folder).toBeTruthy();

    if (folder) {
      // Simulate Device B adding a bookmark
      await extensionPage.evaluate(async (folderId) => {
        await chrome.bookmarks.create({
          parentId: folderId,
          title: 'From Device B',
          url: 'https://device-b.com',
        });
      }, folder.id);

      await extensionPage.waitForTimeout(1000);

      // Device A adds a tab (browser-level action)
      await extensionPage.evaluate(async (gid) => {
        const tab = await chrome.tabs.create({ url: 'https://device-a.com', active: false });
        await chrome.tabs.group({ groupId: gid, tabIds: [tab.id!] });
      }, groupId);

      await extensionPage.waitForTimeout(5000);

      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      const urls = bookmarks.filter(b => b.url).map(b => b.url);

      expect(urls).toContain('https://example.com/');
      expect(urls).toContain('https://device-b.com/');
      expect(urls).toContain('https://device-a.com/');
    }
  });
});
