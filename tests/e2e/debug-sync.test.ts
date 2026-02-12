import { test, expect } from './fixtures';
import {
  setupExtensionViaUI,
  createAndSyncTabGroup,
  waitForGroupBookmarks,
} from './utils';

test('debug: basic sync flow via UI', async ({ extensionPage, extensionId }) => {
  await setupExtensionViaUI(extensionPage, extensionId, {
    containerFolderName: 'Debug Container',
    enableAutoSync: true,
  });

  await createAndSyncTabGroup(extensionPage, extensionId, {
    title: 'Debug Group',
    color: 'blue',
    urls: ['https://example.com'],
  });

  const bookmarks = await waitForGroupBookmarks(extensionPage, 'Debug Group', 1);
  expect(bookmarks.filter(b => b.url)).toHaveLength(1);
  expect(bookmarks[0].url).toContain('example.com');
});
