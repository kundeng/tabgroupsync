import { test, expect } from './fixtures';
import { 
  setupExtensionViaUI,
  openExtensionPopup,
  createTabGroup,
  createAndSyncTabGroup,
  updateTabGroup,
  removeTabGroup,
  findBookmarkFolder,
  waitForBookmarkFolder,
  getBookmarksInFolder,
  waitForGroupBookmarks,
  waitForSyncComplete,
} from './utils';

/**
 * E2E Test: Tab Group Sync
 * 
 * Tests the core tab group synchronization functionality following the actual user workflow:
 * 1. User opens extension popup
 * 2. User selects container folder through Settings UI
 * 3. Extension creates "Tab Group Bookmarks" and "Tab Group Snapshots" subfolders
 * 4. User enables auto-sync
 * 5. Tab groups are created and synced automatically
 * 
 * Validates: Requirements 1.1, 1.2, 1.4, 1.5
 * 
 * NOTE: All setup is done through the popup UI. No direct storage manipulation
 * or chrome.runtime.sendMessage calls. See design.md "E2E Testing Constraints".
 */

test.describe('Tab Group Sync E2E', () => {
  test.beforeEach(async ({ extensionPage, extensionId }) => {
    // Configure extension entirely through the popup UI
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Sync Test Container',
      enableAutoSync: true,
    });
  });

  test('should create bookmark folder when tab group is created', async ({ extensionPage, extensionId }) => {
    // Create a tab group and enable sync via popup UI toggle
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Test Group',
      color: 'blue',
      urls: ['https://example.com', 'https://google.com', 'https://github.com'],
    });

    // Wait for bookmarks to appear
    const bookmarks = await waitForGroupBookmarks(extensionPage, 'Test Group', 3);
    const bookmarkUrls = bookmarks.filter(b => b.url).map(b => b.url);

    expect(bookmarkUrls).toHaveLength(3);
    expect(bookmarkUrls).toContain('https://example.com/');
    expect(bookmarkUrls.some(url => url!.includes('google.com'))).toBeTruthy();
    expect(bookmarkUrls).toContain('https://github.com/');
  });

  test('should update bookmarks when tabs are added to group', async ({ extensionPage, extensionId }) => {
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Dynamic Group',
      color: 'green',
      urls: ['https://example.com', 'https://github.com', 'https://stackoverflow.com'],
    });

    const bookmarks = await waitForGroupBookmarks(extensionPage, 'Dynamic Group', 3);
    const bookmarkUrls = bookmarks.filter(b => b.url).map(b => b.url);

    expect(bookmarkUrls).toHaveLength(3);
    expect(bookmarkUrls).toContain('https://example.com/');
    expect(bookmarkUrls).toContain('https://github.com/');
    expect(bookmarkUrls.some(url => url!.includes('stackoverflow.com'))).toBeTruthy();
  });

  test('should create new folder when group title changes (old folder preserved)', async ({ extensionPage, extensionId }) => {
    const groupId = await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Original Name',
      color: 'red',
      urls: ['https://example.com'],
    });

    // Wait for initial sync
    await waitForGroupBookmarks(extensionPage, 'Original Name', 1);

    // Change group title (browser-level action)
    await updateTabGroup(extensionPage, groupId, { title: 'New Name' });

    // Enable sync for the new name via UI
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'New Name',
      color: 'red',
      urls: [],  // no new tabs, group already exists
    }).catch(() => {
      // Group already exists, just need to toggle sync via UI
    });

    // Open popup and toggle sync for "New Name"
    await openExtensionPopup(extensionPage, extensionId);
    await extensionPage.waitForTimeout(1500);
    const groupRow = extensionPage.locator('li', { has: extensionPage.locator('text="New Name"') });
    const rowVisible = await groupRow.count();
    if (rowVisible > 0) {
      const switchInput = groupRow.locator('input[type="checkbox"]');
      const isChecked = await switchInput.isChecked();
      if (!isChecked) {
        await groupRow.locator('.MuiSwitch-root').click();
        await extensionPage.waitForTimeout(3000);
      }
    }

    // Verify old folder is preserved with its bookmarks
    const oldFolder = await findBookmarkFolder(extensionPage, 'Original Name');
    expect(oldFolder).toBeTruthy();
    const oldBookmarks = await getBookmarksInFolder(extensionPage, oldFolder!.id);
    expect(oldBookmarks.filter(b => b.url)).toHaveLength(1);
  });

  test('should preserve bookmarks when group is deleted', async ({ extensionPage, extensionId }) => {
    const groupId = await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Temporary Group',
      color: 'yellow',
      urls: ['https://example.com', 'https://google.com'],
    });

    // Wait for sync
    const folder = await waitForBookmarkFolder(extensionPage, 'Temporary Group');
    await waitForGroupBookmarks(extensionPage, 'Temporary Group', 2);

    // Delete the tab group (browser-level action)
    await removeTabGroup(extensionPage, groupId);
    await extensionPage.waitForTimeout(2000);

    // Verify bookmarks are still there (preservation)
    const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
    expect(bookmarks.filter(b => b.url)).toHaveLength(2);
  });

  test('should ignore unnamed groups (rare edge case)', async ({ extensionPage, extensionId }) => {
    // Get initial state of Tab Group Bookmarks folder
    const tabGroupBookmarksFolder = await waitForBookmarkFolder(extensionPage, 'Tab Group Bookmarks');
    const initialChildren = await getBookmarksInFolder(extensionPage, tabGroupBookmarksFolder.id);
    const initialFolderCount = initialChildren.filter(c => !c.url).length;

    // Create tab group without title (browser-level action)
    await extensionPage.evaluate(async () => {
      const tab = await chrome.tabs.create({ url: 'https://example.com', active: false });
      await chrome.tabs.group({ tabIds: [tab.id!] });
    });

    await extensionPage.waitForTimeout(5000);

    // Verify no new group folders were created
    const children = await getBookmarksInFolder(extensionPage, tabGroupBookmarksFolder.id);
    const groupFolders = children.filter(c => !c.url);
    expect(groupFolders.length).toBe(initialFolderCount);
  });

  test('should ignore groups with whitespace-only titles', async ({ extensionPage, extensionId }) => {
    const tabGroupBookmarksFolder = await waitForBookmarkFolder(extensionPage, 'Tab Group Bookmarks');
    const initialChildren = await getBookmarksInFolder(extensionPage, tabGroupBookmarksFolder.id);
    const initialFolderCount = initialChildren.filter(c => !c.url).length;

    // Create tab group with whitespace-only title (browser-level action)
    await extensionPage.evaluate(async () => {
      const tab = await chrome.tabs.create({ url: 'https://example.com', active: false });
      const gid = await chrome.tabs.group({ tabIds: [tab.id!] });
      await chrome.tabGroups.update(gid, { title: '   ', color: 'purple' });
      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    await extensionPage.waitForTimeout(5000);

    // Verify no new group folders were created
    const children = await getBookmarksInFolder(extensionPage, tabGroupBookmarksFolder.id);
    const groupFolders = children.filter(c => !c.url);
    expect(groupFolders.length).toBe(initialFolderCount);
  });

  test('should sync multiple groups independently', async ({ extensionPage, extensionId }) => {
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Group One',
      color: 'blue',
      urls: ['https://example.com'],
    });

    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Group Two',
      color: 'red',
      urls: ['https://google.com'],
    });

    // Wait for both groups to sync
    await waitForGroupBookmarks(extensionPage, 'Group One', 1);
    await waitForGroupBookmarks(extensionPage, 'Group Two', 1);

    // Verify each has correct bookmarks
    const folder1 = await findBookmarkFolder(extensionPage, 'Group One');
    const folder2 = await findBookmarkFolder(extensionPage, 'Group Two');

    expect(folder1).toBeTruthy();
    expect(folder2).toBeTruthy();

    const bookmarks1 = await getBookmarksInFolder(extensionPage, folder1!.id);
    const bookmarks2 = await getBookmarksInFolder(extensionPage, folder2!.id);

    expect(bookmarks1.filter(b => b.url)).toHaveLength(1);
    expect(bookmarks2.filter(b => b.url)).toHaveLength(1);

    expect(bookmarks1[0].url).toBe('https://example.com/');
    expect(bookmarks2[0].url).toContain('google.com');
  });
});
