import { test, expect } from './fixtures';
import {
  createAndSyncTabGroup,
  moveGroupToWindowViaUI,
  openExtensionPopup,
  setupExtensionViaUI,
  waitForGroupBookmarks,
} from './utils';

test.describe('Move Group Across Windows E2E', () => {
  test('moves a group to another window and keeps sync continuity without duplicates', async ({
    extensionPage,
    extensionId,
  }) => {
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Move Group E2E',
      enableAutoSync: true,
    });

    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Move Me',
      color: 'blue',
      urls: ['https://example.com', 'https://example.org'],
    });

    await waitForGroupBookmarks(extensionPage, 'Move Me', 2);

    const targetWindowId = await extensionPage.evaluate(async () => {
      const win = await chrome.windows.create({ url: 'https://developer.mozilla.org/' });
      if (!win.id) {
        throw new Error('Failed to create target window');
      }
      return win.id;
    });

    await openExtensionPopup(extensionPage, extensionId);
    await moveGroupToWindowViaUI(extensionPage, extensionId, 'Move Me', targetWindowId, 'developer.mozilla.org');
    await extensionPage.waitForTimeout(3000);

    const movedGroups = await extensionPage.evaluate(async () => {
      const groups = await chrome.tabGroups.query({});
      return groups.filter((g) => g.title === 'Move Me');
    });

    expect(movedGroups.length).toBe(1);
    expect(movedGroups[0].windowId).toBe(targetWindowId);

    await waitForGroupBookmarks(extensionPage, 'Move Me', 2);

    const folderCount = await extensionPage.evaluate(async () => {
      const results = await chrome.bookmarks.search({ title: 'Move Me' });
      return results.filter((r) => !r.url).length;
    });

    expect(folderCount).toBe(1);
  });
});
