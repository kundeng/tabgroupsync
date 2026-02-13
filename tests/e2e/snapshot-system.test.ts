import { test, expect } from './fixtures';
import { 
  setupExtensionViaUI,
  openExtensionPopup,
  createTabGroup,
  createAndSyncTabGroup,
  createSnapshotViaUI,
  openSnapshotHistory,
  restoreSnapshotViaUI,
  getTabGroups,
  removeTabGroup,
  findBookmarkFolder,
  waitForBookmarkFolder,
  getBookmarksInFolder,
  waitForGroupBookmarks,
  waitForSyncComplete,
} from './utils';

/**
 * E2E Test: Snapshot System
 * 
 * Tests snapshot creation, restoration, and cleanup:
 * - Creating snapshots of synced tab groups via popup UI
 * - Verifying snapshot bookmark structure
 * - Snapshot cleanup when limits are exceeded
 * 
 * Validates: Requirements 5.1, 5.2, 5.4
 * 
 * NOTE: All actions are done through the popup UI. No sendMessageToBackground.
 * See design.md "E2E Testing Constraints".
 */

test.describe('Snapshot System E2E', () => {
  test.beforeEach(async ({ extensionPage, extensionId }) => {
    await setupExtensionViaUI(extensionPage, extensionId, {
      containerFolderName: 'Snapshot Test Container',
      enableAutoSync: true,
    });
  });

  test('should create a snapshot of a synced tab group', async ({ extensionPage, extensionId }) => {
    // Create and sync a tab group
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Snapshot Test',
      color: 'blue',
      urls: ['https://example.com', 'https://google.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Snapshot Test', 2);

    // Create a snapshot via the popup UI (click camera icon)
    await createSnapshotViaUI(extensionPage, extensionId, 'Snapshot Test');

    // Verify snapshot was created in the snapshots folder
    const snapshotsFolder = await findBookmarkFolder(extensionPage, 'Tab Group Snapshots');
    expect(snapshotsFolder).toBeTruthy();

    if (snapshotsFolder) {
      const snapshots = await getBookmarksInFolder(extensionPage, snapshotsFolder.id);
      const snapshotFolders = snapshots.filter(s => !s.url);
      expect(snapshotFolders.length).toBeGreaterThanOrEqual(1);

      // Verify snapshot contains the correct bookmarks
      if (snapshotFolders.length > 0) {
        const snapshotContents = await getBookmarksInFolder(extensionPage, snapshotFolders[0].id);
        const urls = snapshotContents.filter(b => b.url).map(b => b.url);
        expect(urls).toContain('https://example.com/');
        expect(urls.some(u => u!.includes('google.com'))).toBeTruthy();
      }
    }
  });

  test('should create multiple snapshots for the same group', async ({ extensionPage, extensionId }) => {
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Multi Snapshot',
      color: 'red',
      urls: ['https://example.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Multi Snapshot', 1);

    // Create first snapshot via UI
    await createSnapshotViaUI(extensionPage, extensionId, 'Multi Snapshot');

    // Modify the group (add a tab — browser-level action)
    await extensionPage.evaluate(async () => {
      const groups = await chrome.tabGroups.query({ title: 'Multi Snapshot' });
      if (groups.length > 0) {
        const tab = await chrome.tabs.create({ url: 'https://google.com', active: false });
        await chrome.tabs.group({ tabIds: [tab.id!], groupId: groups[0].id });
      }
    });

    await waitForSyncComplete(extensionPage);

    // Create second snapshot via UI
    await createSnapshotViaUI(extensionPage, extensionId, 'Multi Snapshot');

    // Verify both snapshots exist
    const snapshotsFolder = await findBookmarkFolder(extensionPage, 'Tab Group Snapshots');
    expect(snapshotsFolder).toBeTruthy();

    if (snapshotsFolder) {
      const snapshots = await getBookmarksInFolder(extensionPage, snapshotsFolder.id);
      const snapshotFolders = snapshots.filter(s => !s.url);
      expect(snapshotFolders.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('should clean up old snapshots when limit is exceeded', async ({ extensionPage, extensionId }) => {
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Cleanup Test',
      color: 'purple',
      urls: ['https://example.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Cleanup Test', 1);

    // Create multiple snapshots via UI (more than the typical limit of 5)
    for (let i = 0; i < 6; i++) {
      await createSnapshotViaUI(extensionPage, extensionId, 'Cleanup Test');
      await extensionPage.waitForTimeout(500);
    }

    // Verify snapshots were created but limited
    const snapshotsFolder = await findBookmarkFolder(extensionPage, 'Tab Group Snapshots');
    expect(snapshotsFolder).toBeTruthy();

    if (snapshotsFolder) {
      const snapshots = await getBookmarksInFolder(extensionPage, snapshotsFolder.id);
      const snapshotFolders = snapshots.filter(s => !s.url);

      // Should be limited to the max (typically 5)
      expect(snapshotFolders.length).toBeLessThanOrEqual(5);
      expect(snapshotFolders.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('should preserve snapshot data across page reloads', async ({ extensionPage, extensionId }) => {
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Persist Test',
      color: 'cyan',
      urls: ['https://example.com', 'https://google.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Persist Test', 2);

    // Create a snapshot via UI
    await createSnapshotViaUI(extensionPage, extensionId, 'Persist Test');

    // Verify snapshot exists
    let snapshotsFolder = await findBookmarkFolder(extensionPage, 'Tab Group Snapshots');
    expect(snapshotsFolder).toBeTruthy();

    let snapshots = await getBookmarksInFolder(extensionPage, snapshotsFolder!.id);
    let snapshotFolders = snapshots.filter(s => !s.url);
    expect(snapshotFolders.length).toBeGreaterThanOrEqual(1);

    // Reload the popup page
    await extensionPage.reload();
    await extensionPage.waitForTimeout(2000);

    // Verify snapshot still exists after reload (bookmarks persist)
    snapshotsFolder = await findBookmarkFolder(extensionPage, 'Tab Group Snapshots');
    expect(snapshotsFolder).toBeTruthy();

    snapshots = await getBookmarksInFolder(extensionPage, snapshotsFolder!.id);
    snapshotFolders = snapshots.filter(s => !s.url);
    expect(snapshotFolders.length).toBeGreaterThanOrEqual(1);
  });

  test('should restore a snapshot by recreating the tab group', async ({ extensionPage, extensionId }) => {
    // Create and sync a tab group
    await createAndSyncTabGroup(extensionPage, extensionId, {
      title: 'Restore Test',
      color: 'green',
      urls: ['https://example.com', 'https://google.com'],
    });

    await waitForGroupBookmarks(extensionPage, 'Restore Test', 2);

    // Create a snapshot via UI
    await createSnapshotViaUI(extensionPage, extensionId, 'Restore Test');

    // Verify snapshot exists
    const snapshotsFolder = await findBookmarkFolder(extensionPage, 'Tab Group Snapshots');
    expect(snapshotsFolder).toBeTruthy();

    // Restore the snapshot via UI (clicks restore button in history dialog)
    await restoreSnapshotViaUI(extensionPage, extensionId, 'Restore Test');

    // Wait for tabs to be created
    await extensionPage.waitForTimeout(3000);

    // Verify a tab group with the same name exists
    const groups = await getTabGroups(extensionPage);
    const restoredGroups = groups.filter(g => g.title === 'Restore Test');
    expect(restoredGroups.length).toBeGreaterThanOrEqual(1);

    // Verify the restored group has tabs with the expected URLs
    const restoredGroup = restoredGroups[restoredGroups.length - 1]; // latest one
    const tabs = await extensionPage.evaluate(async (gid: number) => {
      const tabs = await chrome.tabs.query({ groupId: gid });
      return tabs.map(t => t.url || t.pendingUrl || '');
    }, restoredGroup.id);

    expect(tabs.some(u => u.includes('example.com'))).toBeTruthy();
    expect(tabs.some(u => u.includes('google.com'))).toBeTruthy();
  });
});
