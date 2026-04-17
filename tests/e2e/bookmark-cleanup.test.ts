import { test, expect } from './fixtures';
import { openExtensionPopup, setupExtensionViaUI } from './utils';

test.describe('Bookmark Folder Cleanup', () => {
  test('scan detects prefix-chain cruft and cleanup removes them while preserving bookmarks', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();

    // ── Setup: configure the extension with a container folder ──────────
    await setupExtensionViaUI(page, extensionId);

    // ── Seed prefix-chain cruft directly via chrome.bookmarks ───────────
    // Simulate the old keystroke bug: folders "s", "sp", "spl", "splunk"
    // all exist under "Tab Group Bookmarks", with only "splunk" being real.
    await openExtensionPopup(page, extensionId);
    const cruftInfo = await page.evaluate(async () => {
      // Find the container folder
      const containers = await chrome.bookmarks.search({ title: 'E2E Test Container' });
      const container = containers.find(b => !b.url);
      if (!container) throw new Error('Container not found');

      const children = await chrome.bookmarks.getChildren(container.id);
      const bookmarksFolder = children.find(c => !c.url && c.title === 'Tab Group Bookmarks');
      if (!bookmarksFolder) throw new Error('Tab Group Bookmarks folder not found');

      // Create prefix-chain cruft: s, sp, spl (empty), splunk (with bookmarks)
      const sFolder = await chrome.bookmarks.create({ parentId: bookmarksFolder.id, title: 's' });
      const spFolder = await chrome.bookmarks.create({ parentId: bookmarksFolder.id, title: 'sp' });
      const splFolder = await chrome.bookmarks.create({ parentId: bookmarksFolder.id, title: 'spl' });
      const splunkFolder = await chrome.bookmarks.create({ parentId: bookmarksFolder.id, title: 'splunk' });

      // Add bookmarks to "splunk" (the real folder)
      await chrome.bookmarks.create({ parentId: splunkFolder.id, title: 'Splunk Docs', url: 'https://docs.splunk.com/' });
      await chrome.bookmarks.create({ parentId: splunkFolder.id, title: 'Splunk Dev', url: 'https://dev.splunk.com/' });

      // Add a bookmark to "sp" (should be merged into "splunk" during cleanup)
      await chrome.bookmarks.create({ parentId: spFolder.id, title: 'Splunk Blog', url: 'https://www.splunk.com/blog' });

      return {
        containerId: bookmarksFolder.id,
        cruftIds: [sFolder.id, spFolder.id, splFolder.id],
        realId: splunkFolder.id,
      };
    });

    // ── Open Settings dialog ────────────────────────────────────────────
    await openExtensionPopup(page, extensionId);
    await page.locator('button[aria-label="Settings"]').first().click().catch(async () => {
      await page.locator('button:has([data-testid="SettingsIcon"])').first().click();
    });
    await page.locator('text=Settings').first().waitFor({ state: 'visible', timeout: 5000 });

    // ── Click "Scan for leftovers" ──────────────────────────────────────
    const scanButton = page.locator('button:has-text("Scan for leftovers")');
    await scanButton.waitFor({ state: 'visible', timeout: 5000 });
    await scanButton.click();

    // ── Verify preview shows the cruft candidates ───────────────────────
    await page.locator('text=Found').waitFor({ state: 'visible', timeout: 10000 });

    const previewText = await page.locator('ul').first().innerText();
    expect(previewText).toContain('s');
    expect(previewText).toContain('sp');
    expect(previewText).toContain('spl');
    // "splunk" should NOT be in the cruft list — it's the real folder
    const listItems = await page.locator('ul li').allInnerTexts();
    const cruftTitles = listItems.map(t => t.split('(')[0].trim());
    expect(cruftTitles).not.toContain('splunk');

    // ── Click "Delete N folders" ────────────────────────────────────────
    const deleteButton = page.locator('button:has-text("Delete")').first();
    await deleteButton.click();

    // ── Wait for success message ────────────────────────────────────────
    await page.locator('text=Cleaned up').waitFor({ state: 'visible', timeout: 10000 });

    // ── Verify: cruft folders are gone, real folder + bookmarks remain ──
    const afterState = await page.evaluate(async (info) => {
      const children = await chrome.bookmarks.getChildren(info.containerId);
      const folders = children.filter(c => !c.url);
      const folderTitles = folders.map(f => f.title);

      // Check the real folder still has bookmarks (including merged ones)
      const realChildren = await chrome.bookmarks.getChildren(info.realId);
      const urls = realChildren.filter(c => c.url).map(c => c.url);

      return { folderTitles, urls };
    }, cruftInfo);

    // Cruft folders should be gone
    expect(afterState.folderTitles).not.toContain('s');
    expect(afterState.folderTitles).not.toContain('sp');
    expect(afterState.folderTitles).not.toContain('spl');

    // Real folder should survive
    expect(afterState.folderTitles).toContain('splunk');

    // Original bookmarks preserved
    expect(afterState.urls).toContain('https://docs.splunk.com/');
    expect(afterState.urls).toContain('https://dev.splunk.com/');

    // Merged bookmark from "sp" should now be in "splunk"
    expect(afterState.urls).toContain('https://www.splunk.com/blog');

    await page.close();
  });
});
