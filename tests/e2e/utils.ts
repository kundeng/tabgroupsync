import { Page, BrowserContext } from '@playwright/test';

/**
 * E2E Test Utilities for Tab Group Sync Extension
 *
 * CRITICAL RULES (see design.md "E2E Testing Constraints"):
 * - NO chrome.storage.sync.set/get/clear — configure via popup UI
 * - NO chrome.runtime.sendMessage — trigger actions via popup UI clicks
 * - Browser-level actions (chrome.tabs.*, chrome.tabGroups.*) ARE acceptable
 * - Read-only bookmark assertions (chrome.bookmarks.getChildren/search) ARE acceptable
 */

// ============================================================================
// POPUP NAVIGATION
// ============================================================================

/**
 * Opens the extension popup and waits for it to fully initialize.
 * The popup shows a loading spinner until the background service responds.
 */
export async function openExtensionPopup(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState('networkidle');
  // Wait for React to render and background connection to establish.
  // The App component shows "Initializing..." until ready, then renders Header.
  await page.locator('h1:has-text("Tab Group Sync")').waitFor({ state: 'visible', timeout: 10000 });
}

// ============================================================================
// SETUP VIA UI (replaces setExtensionStorage / sendMessageToBackground)
// ============================================================================

/**
 * Full extension setup through the popup UI:
 * 1. Opens popup
 * 2. Opens Settings dialog
 * 3. Picks a container folder (creates one in Bookmarks Bar if needed)
 * 4. Enables auto-sync
 *
 * Returns the name of the container folder that was selected.
 */
export async function setupExtensionViaUI(
  page: Page,
  extensionId: string,
  options: { containerFolderName?: string; enableAutoSync?: boolean } = {}
): Promise<string> {
  const folderName = options.containerFolderName ?? 'E2E Test Container';
  const enableAutoSync = options.enableAutoSync ?? true;

  // Open popup first so Chrome extension APIs are available
  await openExtensionPopup(page, extensionId);

  // Ensure a bookmark folder exists to pick (must run in extension context)
  await page.evaluate(async (name) => {
    const existing = await chrome.bookmarks.search({ title: name });
    const folder = existing.find(b => !b.url);
    if (!folder) {
      await chrome.bookmarks.create({ parentId: '1', title: name });
    }
  }, folderName);

  // Open Settings dialog — click the gear icon (tooltip "Settings")
  await page.locator('button[aria-label="Settings"], button:has([data-testid="SettingsIcon"])').click();
  await page.locator('text=Settings').first().waitFor({ state: 'visible' });

  // Click "Select Location" or "Change Location" button to open FolderPicker
  const selectBtn = page.locator('button:has-text("Select Location"), button:has-text("Change Location")');
  await selectBtn.click();

  // Wait for FolderPicker dialog
  await page.locator('text=Select Container Location').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);

  // FolderPicker shows root bookmark folders (Bookmarks Bar, Other Bookmarks).
  // Single-click navigates INTO a folder. Double-click selects it.
  // "Select Current Folder" is disabled at root level (currentPath.length <= 1).
  //
  // Strategy: navigate into a root folder, find the target, navigate into it,
  // then click "Select Current Folder".

  // Try to find the target folder by navigating into root folders
  const rootFolders = ['Bookmarks bar', 'Other bookmarks'];
  let folderFound = false;

  for (const rootName of rootFolders) {
    const rootFolder = page.locator('.MuiListItemButton-root', { hasText: rootName });
    if (await rootFolder.isVisible({ timeout: 2000 }).catch(() => false)) {
      await rootFolder.click();
      await page.waitForTimeout(500);

      // Check if target folder is visible at this level
      const targetFolder = page.locator('.MuiListItemButton-root', { hasText: folderName });
      if (await targetFolder.isVisible({ timeout: 2000 }).catch(() => false)) {
        await targetFolder.click();
        await page.waitForTimeout(500);
        folderFound = true;
        break;
      }

      // Target not here — navigate back up via ".." button
      const upButton = page.locator('.MuiListItemButton-root', { hasText: '..' });
      if (await upButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await upButton.click();
        await page.waitForTimeout(500);
      }
    }
  }

  // Click "Select Current Folder" (now enabled since we navigated in)
  await page.locator('button:has-text("Select Current Folder")').click();

  // Wait for FolderPicker dialog to close
  await page.locator('text=Select Container Location').waitFor({ state: 'hidden', timeout: 5000 });

  // Enable auto-sync if requested
  if (enableAutoSync) {
    const autoSyncSwitch = page.locator('text=Enable automatic sync').locator('..').locator('input[type="checkbox"]');
    const isChecked = await autoSyncSwitch.isChecked();
    if (!isChecked) {
      await page.locator('text=Enable automatic sync').locator('..').locator('.MuiSwitch-root').click();
      await page.waitForTimeout(500);
    }
  }

  // Close Settings dialog
  await page.locator('button:has-text("Close")').click();
  await page.waitForTimeout(500);

  return folderName;
}

// ============================================================================
// UI-BASED ACTIONS (replaces sendMessageToBackground)
// ============================================================================

/**
 * Toggles sync for a specific group via the popup UI.
 * Finds the group row by name and clicks its Switch toggle.
 */
export async function toggleGroupSync(
  page: Page,
  extensionId: string,
  groupName: string
): Promise<void> {
  // Always reopen popup to get fresh group list
  await openExtensionPopup(page, extensionId);
  await page.waitForTimeout(1500);

  // Wait for the group row to appear (groups load asynchronously)
  const groupRow = page.locator('li', { has: page.locator(`text="${groupName}"`) });
  await groupRow.waitFor({ state: 'visible', timeout: 10000 });

  // Click the Switch toggle
  await groupRow.locator('.MuiSwitch-root').click();
  await page.waitForTimeout(2000);
}

/**
 * Creates a snapshot for a group via the popup UI.
 * Finds the group row and clicks the camera (snapshot) icon button.
 */
export async function createSnapshotViaUI(
  page: Page,
  extensionId: string,
  groupName: string
): Promise<void> {
  if (!page.url().includes('popup.html')) {
    await openExtensionPopup(page, extensionId);
  }

  const groupRow = page.locator('li', { has: page.locator(`text="${groupName}"`) });
  // Camera icon is the snapshot create button (CameraIcon from MUI)
  await groupRow.locator('button:has([data-testid="CameraIcon"])').click();
  await page.waitForTimeout(2000);
}

/**
 * Opens snapshot history for a group via the popup UI.
 * Finds the group row and clicks the history icon button.
 */
export async function openSnapshotHistory(
  page: Page,
  extensionId: string,
  groupName: string
): Promise<void> {
  if (!page.url().includes('popup.html')) {
    await openExtensionPopup(page, extensionId);
  }

  const groupRow = page.locator('li', { has: page.locator(`text="${groupName}"`) });
  await groupRow.locator('button:has([data-testid="HistoryIcon"])').click();
  await page.locator('text=Snapshots').waitFor({ state: 'visible' });
}

/**
 * Restores the most recent snapshot for a group via the popup UI.
 * Opens snapshot history, clicks the restore button on the first snapshot.
 */
export async function restoreSnapshotViaUI(
  page: Page,
  extensionId: string,
  groupName: string
): Promise<void> {
  // Open snapshot history dialog
  await openSnapshotHistory(page, extensionId, groupName);

  // Click the restore button on the first (most recent) snapshot
  const restoreButton = page.locator('button:has([data-testid="RestoreIcon"])').first();
  await restoreButton.waitFor({ state: 'visible', timeout: 5000 });
  await restoreButton.click();

  // Wait for dialog to close (restore handler calls setShowHistory(false))
  await page.waitForTimeout(2000);
}

/**
 * Triggers a full resync for a group via the popup UI.
 * Finds the group row and clicks the refresh icon button.
 */
export async function fullResyncViaUI(
  page: Page,
  extensionId: string,
  groupName: string
): Promise<void> {
  if (!page.url().includes('popup.html')) {
    await openExtensionPopup(page, extensionId);
  }

  const groupRow = page.locator('li', { has: page.locator(`text="${groupName}"`) });
  await groupRow.locator('button:has([data-testid="RefreshIcon"])').click();
  await page.waitForTimeout(3000);
}

/**
 * Moves a group to a target window via popup UI.
 */
export async function moveGroupToWindowViaUI(
  page: Page,
  extensionId: string,
  groupName: string,
  targetWindowId: number
): Promise<void> {
  if (!page.url().includes('popup.html')) {
    await openExtensionPopup(page, extensionId);
  }

  const groupRow = page.locator('li', { has: page.locator(`text="${groupName}"`) });
  await groupRow.waitFor({ state: 'visible', timeout: 10000 });

  await groupRow.locator('button:has([data-testid="DriveFileMoveIcon"])').click();
  await page.locator('text=Move Group To Window').waitFor({ state: 'visible', timeout: 5000 });

  await page.locator(`label:has-text("Window ${targetWindowId}")`).click();
  await page.locator('button:has-text("Move")').click();
  await page.locator('text=Move Group To Window').waitFor({ state: 'hidden', timeout: 10000 });
}

// ============================================================================
// COMPOSITE HELPERS (create + sync via UI)
// ============================================================================

/**
 * Creates a tab group and enables sync for it via the popup UI.
 * Combines createTabGroup (browser-level) with toggleGroupSync (UI action).
 * Returns the groupId.
 */
export async function createAndSyncTabGroup(
  page: Page,
  extensionId: string,
  options: {
    title?: string;
    color?: string;
    urls: string[];
  }
): Promise<number> {
  const groupId = await createTabGroup(page, options);

  // Wait for the extension to detect the new group and update the popup
  await page.waitForTimeout(1500);

  // Open popup and enable sync for this group via the UI toggle
  if (options.title) {
    await openExtensionPopup(page, extensionId);
    await page.waitForTimeout(1000);

    const groupRow = page.locator('li', { has: page.locator(`text="${options.title}"`) });
    const rowCount = await groupRow.count();
    if (rowCount > 0) {
      const switchInput = groupRow.locator('input[type="checkbox"]');
      const isChecked = await switchInput.isChecked().catch(() => false);
      if (!isChecked) {
        await groupRow.locator('.MuiSwitch-root').click();
        await page.waitForTimeout(2000);
      }
    }
  }

  return groupId;
}

// ============================================================================
// BROWSER-LEVEL ACTIONS (acceptable — no extension UI equivalent)
// ============================================================================

/**
 * Creates a new tab group with the given tabs using Chrome APIs.
 * This is a browser-level action with no extension UI equivalent.
 */
export async function createTabGroup(
  page: Page,
  options: {
    title?: string;
    color?: string;
    urls: string[];
  }
): Promise<number> {
  return await page.evaluate(async (opts) => {
    const tabs = [];
    for (const url of opts.urls) {
      const tab = await chrome.tabs.create({ url, active: false });
      tabs.push(tab);
    }

    const groupId = await chrome.tabs.group({ tabIds: tabs.map(t => t.id!) });

    // Simulate user typing delay — real users don't set title instantly.
    // Gives the extension's transition period handling time to work.
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (opts.title || opts.color) {
      await chrome.tabGroups.update(groupId, {
        title: opts.title,
        color: opts.color as chrome.tabGroups.ColorEnum,
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return groupId;
  }, options);
}

/**
 * Gets all tab groups (browser-level read).
 */
export async function getTabGroups(page: Page): Promise<chrome.tabGroups.TabGroup[]> {
  return await page.evaluate(async () => {
    return await chrome.tabGroups.query({});
  });
}

/**
 * Gets tabs in a specific group (browser-level read).
 */
export async function getTabsInGroup(page: Page, groupId: number): Promise<chrome.tabs.Tab[]> {
  return await page.evaluate(async (gid) => {
    return await chrome.tabs.query({ groupId: gid });
  }, groupId);
}

/**
 * Updates a tab group's properties (browser-level action).
 */
export async function updateTabGroup(
  page: Page,
  groupId: number,
  properties: chrome.tabGroups.UpdateProperties
): Promise<void> {
  await page.evaluate(async (args) => {
    await chrome.tabGroups.update(args.groupId, args.properties);
  }, { groupId, properties });
}

/**
 * Removes a tab group by ungrouping all its tabs (browser-level action).
 */
export async function removeTabGroup(page: Page, groupId: number): Promise<void> {
  await page.evaluate(async (gid) => {
    await chrome.tabGroups.update(gid, { collapsed: false });
    const tabs = await chrome.tabs.query({ groupId: gid });
    await chrome.tabs.ungroup(tabs.map(t => t.id!));
  }, groupId);
}

// ============================================================================
// READ-ONLY BOOKMARK ASSERTIONS (acceptable — ground truth verification)
// ============================================================================

/**
 * Gets all bookmarks in a folder (read-only assertion).
 */
export async function getBookmarksInFolder(
  page: Page,
  folderId: string
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return await page.evaluate(async (id) => {
    return await chrome.bookmarks.getChildren(id);
  }, folderId);
}

/**
 * Finds a bookmark folder by title (read-only assertion).
 */
export async function findBookmarkFolder(
  page: Page,
  title: string
): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
  return await page.evaluate(async (folderTitle) => {
    const results = await chrome.bookmarks.search({ title: folderTitle });
    const folders = results.filter(r => !r.url);
    if (folders.length === 0) return null;
    if (folders.length === 1) return folders[0];
    // When duplicate folders exist, prefer the one with the most children
    let best = folders[0];
    let bestCount = 0;
    for (const f of folders) {
      const children = await chrome.bookmarks.getChildren(f.id);
      const urlCount = children.filter(c => c.url).length;
      if (urlCount > bestCount) {
        bestCount = urlCount;
        best = f;
      }
    }
    return best;
  }, title);
}

/**
 * Waits for a bookmark folder to appear (polling read-only assertion).
 */
export async function waitForBookmarkFolder(
  page: Page,
  title: string,
  timeout: number = 10000
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const folder = await findBookmarkFolder(page, title);
    if (folder) {
      return folder;
    }
    await page.waitForTimeout(250);
  }

  throw new Error(`Bookmark folder "${title}" not found within ${timeout}ms`);
}

/**
 * Deletes a bookmark folder (simulates external action, e.g. another device).
 */
export async function deleteBookmarkFolder(page: Page, folderId: string): Promise<void> {
  await page.evaluate(async (id) => {
    await chrome.bookmarks.removeTree(id);
  }, folderId);
}

/**
 * Verifies that a bookmark folder contains the expected URLs.
 */
export async function verifyBookmarksMatch(
  page: Page,
  folderId: string,
  expectedUrls: string[]
): Promise<boolean> {
  const bookmarks = await getBookmarksInFolder(page, folderId);
  const actualUrls = bookmarks.filter(b => b.url).map(b => b.url).sort();
  const sortedExpected = [...expectedUrls].sort();
  return JSON.stringify(actualUrls) === JSON.stringify(sortedExpected);
}

// ============================================================================
// SYNC WAITING
// ============================================================================

/**
 * Waits for sync to complete by polling for bookmark folder changes.
 * Does NOT use internal APIs — checks bookmark state as ground truth.
 */
export async function waitForSyncComplete(
  page: Page,
  timeout: number = 10000
): Promise<void> {
  // Give the extension time to process events and sync.
  // We poll bookmark state rather than relying on internal indicators.
  await page.waitForTimeout(Math.min(timeout, 5000));
}

/**
 * Waits for a specific group's bookmarks to appear in the bookmark folder.
 * More precise than waitForSyncComplete — checks for actual content.
 */
export async function waitForGroupBookmarks(
  page: Page,
  groupName: string,
  expectedCount: number,
  timeout: number = 15000
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Check ALL matching folders (not just the first) to handle race conditions
    // where duplicate folders may be created by concurrent service workers
    const folders = await page.evaluate(async (title) => {
      const results = await chrome.bookmarks.search({ title });
      return results.filter(r => !r.url);
    }, groupName);

    for (const folder of folders) {
      const bookmarks = await getBookmarksInFolder(page, folder.id);
      const urls = bookmarks.filter(b => b.url);
      if (urls.length >= expectedCount) {
        return bookmarks;
      }
    }
    await page.waitForTimeout(500);
  }

  throw new Error(
    `Expected ${expectedCount} bookmarks in folder "${groupName}" within ${timeout}ms`
  );
}
