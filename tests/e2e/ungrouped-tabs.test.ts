import { test, expect } from './fixtures';
import { 
  setupExtensionViaUI,
  createTabGroup,
  findBookmarkFolder,
  waitForBookmarkFolder,
  getBookmarksInFolder,
  waitForGroupBookmarks,
  waitForSyncComplete,
} from './utils';

/**
 * E2E Test: Ungrouped Tab Handling
 * 
 * Tests that ungrouped tabs are properly excluded:
 * - Ungrouped tabs are not synced
 * - Ungrouped tabs don't appear in UI
 * - Bookmark preservation when tab is ungrouped
 * 
 * Validates: Requirements 13.1, 13.2, 13.3
 * 
 * NOTE: All setup is done through the popup UI. No direct storage manipulation.
 * See design.md "E2E Testing Constraints".
 */

test.describe('Ungrouped Tab Handling E2E', () => {
  test.beforeEach(async ({ extensionPage, extensionId }) => {
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Ungrouped Test Container',
      enableAutoSync: true,
    });
  });

  test('should not sync ungrouped tabs', async ({ extensionPage, extensionId }) => {
    // Create some ungrouped tabs
    await extensionPage.evaluate(() => {
      return Promise.all([
        chrome.tabs.create({ url: 'https://ungrouped1.com', active: false }),
        chrome.tabs.create({ url: 'https://ungrouped2.com', active: false }),
        chrome.tabs.create({ url: 'https://ungrouped3.com', active: false })
      ]);
    });

    await extensionPage.waitForTimeout(5000);

    // Verify no bookmarks were created for ungrouped tabs
    const bookmarksFolder = await findBookmarkFolder(extensionPage, 'Tab Group Bookmarks');
    
    if (bookmarksFolder) {
      const children = await getBookmarksInFolder(extensionPage, bookmarksFolder.id);
      // Should have no folders (no groups created)
      expect(children.filter(c => !c.url)).toHaveLength(0);
    }

    // Verify ungrouped tabs exist but aren't synced
    const ungroupedTabs = await extensionPage.evaluate(() => {
      return chrome.tabs.query({ groupId: chrome.tabGroups.TAB_GROUP_ID_NONE });
    });

    expect(ungroupedTabs.length).toBeGreaterThan(0);
  });

  test('should not create bookmarks when tabs are ungrouped', async ({ extensionPage, extensionId }) => {
    // Create a tab group
    const groupId = await createTabGroup(extensionPage, {
      title: 'Ungroup Test',
      color: 'blue',
      urls: ['https://example.com', 'https://google.com']
    });

    await waitForSyncComplete(extensionPage);

    // Verify bookmarks were created
    const folder = await waitForBookmarkFolder(extensionPage, 'Ungroup Test');
    expect(folder).toBeTruthy();

    if (folder) {
      let bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      expect(bookmarks.filter(b => b.url)).toHaveLength(2);
    }

    // Ungroup all tabs
    await extensionPage.evaluate((gid) => {
      return chrome.tabs.query({ groupId: gid }).then(tabs => {
        return chrome.tabs.ungroup(tabs.map(t => t.id!));
      });
    }, groupId);

    await extensionPage.waitForTimeout(2000);

    // Verify bookmarks are preserved (not deleted)
    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      expect(bookmarks.filter(b => b.url)).toHaveLength(2);
    }

    // Verify tabs are now ungrouped
    const ungroupedTabs = await extensionPage.evaluate(() => {
      return chrome.tabs.query({ groupId: chrome.tabGroups.TAB_GROUP_ID_NONE });
    });

    const testUrls = ungroupedTabs.filter(t => 
      t.url === 'https://example.com/' || t.url === 'https://google.com/'
    );
    expect(testUrls.length).toBe(2);
  });

  test('should preserve bookmarks when tab is removed from group', async ({ extensionPage, extensionId }) => {
    // Create a tab group with multiple tabs
    const groupId = await createTabGroup(extensionPage, {
      title: 'Remove Tab Test',
      color: 'red',
      urls: ['https://example.com', 'https://google.com', 'https://github.com']
    });

    await waitForSyncComplete(extensionPage);

    const folder = await waitForBookmarkFolder(extensionPage, 'Remove Tab Test');
    expect(folder).toBeTruthy();

    if (folder) {
      let bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      expect(bookmarks.filter(b => b.url)).toHaveLength(3);
    }

    // Remove one tab from the group (ungroup it)
    await extensionPage.evaluate((gid) => {
      return chrome.tabs.query({ groupId: gid }).then(tabs => {
        // Ungroup just the first tab
        return chrome.tabs.ungroup([tabs[0].id!]);
      });
    }, groupId);

    await extensionPage.waitForTimeout(3000);

    // Verify bookmark is still there (preserved)
    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      expect(bookmarks.filter(b => b.url)).toHaveLength(3);
    }

    // Verify the tab is now ungrouped
    const ungroupedTabs = await extensionPage.evaluate(() => {
      return chrome.tabs.query({ groupId: chrome.tabGroups.TAB_GROUP_ID_NONE });
    });

    expect(ungroupedTabs.length).toBeGreaterThan(0);
  });

  test('should not sync new tabs added to ungrouped state', async ({ extensionPage, extensionId }) => {
    // Create a tab group first
    const groupId = await createTabGroup(extensionPage, {
      title: 'Mixed State Test',
      color: 'green',
      urls: ['https://grouped.com']
    });

    await waitForSyncComplete(extensionPage);

    // Create ungrouped tabs
    await extensionPage.evaluate(() => {
      return Promise.all([
        chrome.tabs.create({ url: 'https://ungrouped-new1.com', active: false }),
        chrome.tabs.create({ url: 'https://ungrouped-new2.com', active: false })
      ]);
    });

    await extensionPage.waitForTimeout(5000);

    // Verify only the grouped tab was synced
    const folder = await findBookmarkFolder(extensionPage, 'Mixed State Test');
    expect(folder).toBeTruthy();

    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      const urls = bookmarks.filter(b => b.url).map(b => b.url);
      
      expect(urls).toContain('https://grouped.com/');
      expect(urls).not.toContain('https://ungrouped-new1.com/');
      expect(urls).not.toContain('https://ungrouped-new2.com/');
    }
  });

  test('should handle tab moving between grouped and ungrouped states', async ({ extensionPage, extensionId }) => {
    // Create a tab group
    const groupId = await createTabGroup(extensionPage, {
      title: 'State Change Test',
      color: 'yellow',
      urls: ['https://example.com']
    });

    await waitForSyncComplete(extensionPage);

    const folder = await waitForBookmarkFolder(extensionPage, 'State Change Test');
    expect(folder).toBeTruthy();

    // Ungroup the tab
    await extensionPage.evaluate((gid) => {
      return chrome.tabs.query({ groupId: gid }).then(tabs => {
        return chrome.tabs.ungroup(tabs.map(t => t.id!));
      });
    }, groupId);

    await extensionPage.waitForTimeout(2000);

    // Verify bookmark is preserved
    if (folder) {
      let bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      expect(bookmarks.filter(b => b.url)).toHaveLength(1);
    }

    // Re-group the tab
    const newGroupId = await extensionPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://example.com/' });
      if (tabs.length > 0) {
        const gid = await chrome.tabs.group({ tabIds: [tabs[0].id!] });
        await chrome.tabGroups.update(gid, { 
          title: 'State Change Test',
          color: 'yellow'
        });
        return gid;
      }
      return -1;
    });

    await extensionPage.waitForTimeout(5000);

    // Verify bookmark still exists (no duplicates)
    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      expect(bookmarks.filter(b => b.url)).toHaveLength(1);
    }
  });

  test('should filter ungrouped tabs from sync operations', async ({ extensionPage, extensionId }) => {
    // Create mixed state: some grouped, some ungrouped
    await extensionPage.evaluate(() => {
      return chrome.tabs.create({ url: 'https://ungrouped-before.com', active: false });
    });

    const groupId = await createTabGroup(extensionPage, {
      title: 'Filter Test',
      color: 'purple',
      urls: ['https://grouped1.com', 'https://grouped2.com']
    });

    await extensionPage.evaluate(() => {
      return chrome.tabs.create({ url: 'https://ungrouped-after.com', active: false });
    });

    await waitForSyncComplete(extensionPage);

    // Verify only grouped tabs were synced
    const folder = await waitForBookmarkFolder(extensionPage, 'Filter Test');
    expect(folder).toBeTruthy();

    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      const urls = bookmarks.filter(b => b.url).map(b => b.url);
      
      expect(urls).toHaveLength(2);
      expect(urls).toContain('https://grouped1.com/');
      expect(urls).toContain('https://grouped2.com/');
      expect(urls).not.toContain('https://ungrouped-before.com/');
      expect(urls).not.toContain('https://ungrouped-after.com/');
    }
  });

  test('should handle all tabs being ungrouped', async ({ extensionPage, extensionId }) => {
    // Create a tab group
    const groupId = await createTabGroup(extensionPage, {
      title: 'All Ungrouped Test',
      color: 'cyan',
      urls: ['https://example.com', 'https://google.com']
    });

    await waitForSyncComplete(extensionPage);

    const folder = await waitForBookmarkFolder(extensionPage, 'All Ungrouped Test');
    expect(folder).toBeTruthy();

    // Ungroup all tabs
    await extensionPage.evaluate((gid) => {
      return chrome.tabs.query({ groupId: gid }).then(tabs => {
        return chrome.tabs.ungroup(tabs.map(t => t.id!));
      });
    }, groupId);

    await extensionPage.waitForTimeout(2000);

    // Verify bookmarks are preserved
    if (folder) {
      const bookmarks = await getBookmarksInFolder(extensionPage, folder.id);
      expect(bookmarks.filter(b => b.url)).toHaveLength(2);
    }

    // Verify no grouped tabs remain
    const groupedTabs = await extensionPage.evaluate((gid) => {
      return chrome.tabs.query({ groupId: gid });
    }, groupId);

    expect(groupedTabs).toHaveLength(0);
  });

  test('should not create "Ungrouped" folder', async ({ extensionPage, extensionId }) => {
    // Create many ungrouped tabs
    for (let i = 0; i < 10; i++) {
      await extensionPage.evaluate((index) => {
        return chrome.tabs.create({ 
          url: `https://ungrouped${index}.com`, 
          active: false 
        });
      }, i);
    }

    await extensionPage.waitForTimeout(5000);

    // Verify no "Ungrouped" folder was created
    const ungroupedFolder = await findBookmarkFolder(extensionPage, 'Ungrouped');
    expect(ungroupedFolder).toBeNull();

    // Also check for variations
    const ungroupedTabsFolder = await findBookmarkFolder(extensionPage, 'Ungrouped Tabs');
    expect(ungroupedTabsFolder).toBeNull();

    const noGroupFolder = await findBookmarkFolder(extensionPage, 'No Group');
    expect(noGroupFolder).toBeNull();
  });
});
