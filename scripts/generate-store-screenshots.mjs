// Generate Chrome Web Store screenshots (1280x800) and promo tile (440x280).
//
// Launches Chrome with the built extension, seeds realistic mock tab groups,
// drives the popup UI into each target state, screenshots the popup at its
// native 480x600, then composes it onto a marketing canvas via an HTML
// wrapper for the final store-ready PNG.
//
// Run with:   xvfb-run -a node scripts/generate-store-screenshots.mjs
//
// Outputs:    docs/store-assets/*.png

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_PATH = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'docs/store-assets');
const USER_DATA_DIR = path.join(ROOT, '.playwright-chrome-data', 'screenshots');

const SCREENSHOT_W = 1280;
const SCREENSHOT_H = 800;

const POPUP_W = 480;
const POPUP_H = 600;

const MOCK_GROUPS = [
  {
    title: 'Work',
    color: 'blue',
    urls: [
      'https://github.com/kundeng/tabgroupsync',
      'https://linear.app/',
      'https://mail.google.com/',
    ],
  },
  {
    title: 'Research',
    color: 'red',
    urls: [
      'https://arxiv.org/',
      'https://en.wikipedia.org/wiki/Chrome_extension',
      'https://scholar.google.com/',
      'https://www.nature.com/',
    ],
  },
  {
    title: 'Shopping',
    color: 'green',
    urls: [
      'https://www.amazon.com/',
      'https://www.target.com/',
      'https://www.bestbuy.com/',
    ],
  },
  {
    title: 'Travel',
    color: 'yellow',
    urls: [
      'https://www.kayak.com/',
      'https://www.airbnb.com/',
    ],
  },
];

function ensureOutDir() {
  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function getExtensionId(context) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const [sw] = context.serviceWorkers();
    if (sw) return sw.url().split('/')[2];
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Could not resolve extension service worker');
}

async function seedTabGroups(page) {
  for (const g of MOCK_GROUPS) {
    await page.evaluate(async (group) => {
      const tabs = [];
      for (const url of group.urls) {
        const tab = await chrome.tabs.create({ url, active: false });
        tabs.push(tab);
      }
      const groupId = await chrome.tabs.group({ tabIds: tabs.map(t => t.id) });
      await new Promise(r => setTimeout(r, 400));
      await chrome.tabGroups.update(groupId, { title: group.title, color: group.color });
      await new Promise(r => setTimeout(r, 300));
    }, g);
  }
}

async function openPopup(context, extensionId, { width = POPUP_W, height = POPUP_H } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState('networkidle');
  await page.locator('h1:has-text("Tab Group Sync")').waitFor({ state: 'visible', timeout: 15000 });
  // Give MUI transitions a moment and the background a chance to respond.
  await page.waitForTimeout(1500);
  return page;
}

async function capturePopupPng(popupPage) {
  return await popupPage.screenshot({ type: 'png', fullPage: false });
}

// Compose a popup PNG onto a 1280x800 marketing canvas with caption text.
async function composeScreenshot(browser, popupPng, { title, subtitle, gradient }, outfile) {
  const dataUrl = `data:image/png;base64,${popupPng.toString('base64')}`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${SCREENSHOT_W}px; height: ${SCREENSHOT_H}px; overflow: hidden; }
  body {
    display: flex; align-items: center; justify-content: space-around;
    background: ${gradient};
    font-family: -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #fff;
  }
  .caption { max-width: 540px; padding: 0 40px; }
  .caption h1 { font-size: 48px; line-height: 1.15; font-weight: 700; letter-spacing: -0.5px; }
  .caption p { margin-top: 20px; font-size: 20px; line-height: 1.5; color: rgba(255,255,255,0.92); }
  .frame {
    width: ${POPUP_W}px; height: ${POPUP_H}px;
    border-radius: 14px; overflow: hidden;
    box-shadow: 0 30px 80px rgba(0,0,0,0.35), 0 10px 30px rgba(0,0,0,0.25);
    background: #fff;
  }
  .frame img { display: block; width: 100%; height: 100%; }
  .badge {
    display: inline-block; padding: 6px 14px; border-radius: 999px;
    background: rgba(255,255,255,0.18); backdrop-filter: blur(8px);
    font-size: 13px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;
    margin-bottom: 20px;
  }
</style></head>
<body>
  <div class="caption">
    <div class="badge">Tab Group Sync</div>
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </div>
  <div class="frame"><img src="${dataUrl}" width="${POPUP_W}" height="${POPUP_H}"></div>
</body></html>`;

  const page = await browser.newPage();
  await page.setViewportSize({ width: SCREENSHOT_W, height: SCREENSHOT_H });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: outfile, type: 'png', fullPage: false, clip: { x: 0, y: 0, width: SCREENSHOT_W, height: SCREENSHOT_H } });
  await page.close();
}

async function composeFullViewport(browser, rawPng, { title, subtitle, gradient }, outfile) {
  // For full-viewport captures (e.g. bookmark manager) — render as a framed image
  // centered on the marketing canvas, scaled down to fit.
  const dataUrl = `data:image/png;base64,${rawPng.toString('base64')}`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${SCREENSHOT_W}px; height: ${SCREENSHOT_H}px; overflow: hidden; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: ${gradient};
    font-family: -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #fff; padding: 36px;
  }
  h1 { font-size: 34px; line-height: 1.2; font-weight: 700; margin-bottom: 8px; }
  p  { font-size: 16px; line-height: 1.5; color: rgba(255,255,255,0.92); margin-bottom: 22px; }
  .frame {
    width: 1100px; height: 600px; border-radius: 12px; overflow: hidden;
    box-shadow: 0 25px 70px rgba(0,0,0,0.35), 0 8px 25px rgba(0,0,0,0.25);
    background: #fff;
  }
  .frame img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
</style></head>
<body>
  <h1>${title}</h1>
  <p>${subtitle}</p>
  <div class="frame"><img src="${dataUrl}"></div>
</body></html>`;
  const page = await browser.newPage();
  await page.setViewportSize({ width: SCREENSHOT_W, height: SCREENSHOT_H });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: outfile, type: 'png' });
  await page.close();
}

async function makePromoTile(browser, outfile) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 440px; height: 280px; overflow: hidden; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #1a73e8 0%, #174ea6 100%);
    font-family: -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #fff; text-align: center; padding: 24px;
  }
  .logo-row { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; }
  .logo {
    width: 56px; height: 56px; border-radius: 14px;
    background: rgba(255,255,255,0.14); display: flex; align-items: center; justify-content: center;
    font-size: 28px;
  }
  h1 { font-size: 34px; font-weight: 700; letter-spacing: -0.5px; line-height: 1.05; }
  p  { margin-top: 14px; font-size: 16px; line-height: 1.4; color: rgba(255,255,255,0.92); max-width: 360px; }
  .pill {
    margin-top: 16px; display: inline-flex; gap: 8px; padding: 6px 14px;
    background: rgba(255,255,255,0.14); border-radius: 999px; font-size: 12px;
    font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;
  }
</style></head>
<body>
  <h1>Tab Group Sync</h1>
  <p>Back up Chrome tab groups as bookmarks. Private. Free.</p>
  <div class="pill">No accounts · No servers · No tracking</div>
</body></html>`;
  const page = await browser.newPage();
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(100);
  await page.screenshot({ path: outfile, type: 'png', clip: { x: 0, y: 0, width: 440, height: 280 } });
  await page.close();
}

async function setupContainerFolder(popup) {
  // Create the bookmark folder the container picker will select.
  await popup.evaluate(async () => {
    const existing = await chrome.bookmarks.search({ title: 'Tab Group Bookmarks' });
    const folder = existing.find(b => !b.url);
    if (!folder) await chrome.bookmarks.create({ parentId: '1', title: 'Tab Group Bookmarks' });
  });
}

async function configureExtensionViaUI(popup) {
  // Open Settings and walk the FolderPicker to select "Tab Group Bookmarks",
  // then enable auto-sync. Mirrors tests/e2e/utils.ts#setupExtensionViaUI.
  const folderName = 'Tab Group Bookmarks';

  await popup.locator('button[aria-label="Settings"]').first().click().catch(async () => {
    await popup.locator('button:has([data-testid="SettingsIcon"])').first().click();
  });
  await popup.locator('text=Settings').first().waitFor({ state: 'visible', timeout: 5000 });

  await popup.locator('button:has-text("Select Location"), button:has-text("Change Location")').first().click();
  await popup.locator('text=Select Container Location').waitFor({ state: 'visible', timeout: 5000 });
  await popup.waitForTimeout(400);

  for (const rootName of ['Bookmarks bar', 'Other bookmarks']) {
    const root = popup.locator('.MuiListItemButton-root', { hasText: rootName });
    if (await root.isVisible({ timeout: 1500 }).catch(() => false)) {
      await root.click();
      await popup.waitForTimeout(400);
      const target = popup.locator('.MuiListItemButton-root', { hasText: folderName });
      if (await target.isVisible({ timeout: 1500 }).catch(() => false)) {
        await target.click();
        await popup.waitForTimeout(400);
        break;
      }
      const up = popup.locator('.MuiListItemButton-root', { hasText: '..' });
      if (await up.isVisible({ timeout: 500 }).catch(() => false)) {
        await up.click();
        await popup.waitForTimeout(300);
      }
    }
  }

  await popup.locator('button:has-text("Select Current Folder")').click();
  await popup.locator('text=Select Container Location').waitFor({ state: 'hidden', timeout: 5000 });

  // Enable auto-sync if not already on.
  const autoSyncCheckbox = popup.locator('text=Enable automatic sync').locator('..').locator('input[type="checkbox"]').first();
  const checked = await autoSyncCheckbox.isChecked().catch(() => false);
  if (!checked) {
    await popup.locator('text=Enable automatic sync').locator('..').locator('.MuiSwitch-root').first().click();
    await popup.waitForTimeout(400);
  }

  await popup.locator('button:has-text("Close")').click();
  await popup.waitForTimeout(600);
}

async function enableSyncForAllGroups(popup) {
  for (const g of MOCK_GROUPS) {
    const row = popup.locator('li', { has: popup.locator(`text="${g.title}"`) }).first();
    if (await row.count() === 0) continue;
    const cb = row.locator('input[type="checkbox"]').first();
    const on = await cb.isChecked().catch(() => false);
    if (!on) {
      await row.locator('.MuiSwitch-root').first().click();
      await popup.waitForTimeout(800);
    }
  }
}

async function main() {
  ensureOutDir();

  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`Extension not built: ${EXT_PATH}`);
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: POPUP_W, height: POPUP_H },
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--window-size=1400,900',
    ],
  });

  const extensionId = await getExtensionId(context);
  console.log(`extension id: ${extensionId}`);

  // Seed groups via a bootstrap page (chrome APIs need an extension context OR a page).
  const bootstrap = await context.newPage();
  await bootstrap.goto(`chrome-extension://${extensionId}/popup.html`);
  await bootstrap.waitForLoadState('networkidle');
  await bootstrap.waitForTimeout(1000);
  await setupContainerFolder(bootstrap);
  await seedTabGroups(bootstrap);
  await bootstrap.close();

  // Give the extension time to observe the new groups.
  await new Promise(r => setTimeout(r, 2000));

  // Configure the extension (container folder + auto-sync) via the popup UI
  // so subsequent screenshots show the fully-configured state.
  {
    const cfg = await openPopup(context, extensionId);
    await configureExtensionViaUI(cfg);
    await enableSyncForAllGroups(cfg);
    await cfg.close();
  }
  await new Promise(r => setTimeout(r, 1500));

  const gradients = {
    blue:   'linear-gradient(135deg, #1a73e8 0%, #174ea6 100%)',
    purple: 'linear-gradient(135deg, #673ab7 0%, #311b92 100%)',
    teal:   'linear-gradient(135deg, #009688 0%, #00695c 100%)',
    pink:   'linear-gradient(135deg, #e91e63 0%, #880e4f 100%)',
    slate:  'linear-gradient(135deg, #455a64 0%, #263238 100%)',
  };

  // ── Screenshot 1: main popup ────────────────────────────────────────────
  {
    const popup = await openPopup(context, extensionId);
    const png = await capturePopupPng(popup);
    await composeScreenshot(context, png,
      { title: 'See all your tab groups at a glance',
        subtitle: 'Every group, every window, every sync status — in one fast popup.',
        gradient: gradients.blue },
      path.join(OUT_DIR, '01-main-popup.png'));
    await popup.close();
    console.log('wrote 01-main-popup.png');
  }

  // ── Screenshot 2: Settings dialog ───────────────────────────────────────
  {
    const popup = await openPopup(context, extensionId);
    await popup.locator('button[aria-label="Settings"]').first().click().catch(async () => {
      await popup.locator('button:has([data-testid="SettingsIcon"])').first().click();
    });
    await popup.locator('text=Settings').first().waitFor({ state: 'visible', timeout: 5000 });
    await popup.waitForTimeout(800);
    const png = await capturePopupPng(popup);
    await composeScreenshot(context, png,
      { title: 'Configure once. Sync forever.',
        subtitle: 'Pick a bookmark folder, enable auto-sync, and set cleanup rules — no accounts required.',
        gradient: gradients.purple },
      path.join(OUT_DIR, '02-settings.png'));
    await popup.close();
    console.log('wrote 02-settings.png');
  }

  // ── Screenshot 3: snapshot history ──────────────────────────────────────
  {
    const popup = await openPopup(context, extensionId);

    // Enable sync for "Work" and create a couple snapshots.
    const workRow = popup.locator('li', { has: popup.locator('text="Work"') }).first();
    const syncSwitch = workRow.locator('.MuiSwitch-root').first();
    const isOn = await workRow.locator('input[type="checkbox"]').isChecked().catch(() => false);
    if (!isOn) { await syncSwitch.click(); await popup.waitForTimeout(1200); }

    const cameraBtn = workRow.locator('button:has([data-testid="CameraIcon"])').first();
    if (await cameraBtn.count() > 0) {
      await cameraBtn.click(); await popup.waitForTimeout(800);
      await cameraBtn.click(); await popup.waitForTimeout(800);
    }
    const historyBtn = workRow.locator('button:has([data-testid="HistoryIcon"])').first();
    if (await historyBtn.count() > 0) {
      await historyBtn.click();
      await popup.locator('text=Snapshots').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await popup.waitForTimeout(600);
    }
    const png = await capturePopupPng(popup);
    await composeScreenshot(context, png,
      { title: 'Point-in-time snapshots',
        subtitle: 'Capture a tab group’s state before big changes. Restore any snapshot in one click.',
        gradient: gradients.teal },
      path.join(OUT_DIR, '03-snapshots.png'));
    await popup.close();
    console.log('wrote 03-snapshots.png');
  }

  // ── Screenshot 4: move group across windows ─────────────────────────────
  {
    // Create a second browser window so the move dialog has a real target.
    // Must run in an extension context to access chrome.windows.create.
    const helper = await context.newPage();
    await helper.goto(`chrome-extension://${extensionId}/popup.html`);
    await helper.waitForLoadState('networkidle');
    await helper.evaluate(async () => {
      await chrome.windows.create({ url: 'https://www.wikipedia.org/', focused: false });
    }).catch(() => {});
    await helper.close();
    await new Promise(r => setTimeout(r, 2000));

    const popup = await openPopup(context, extensionId);
    const workRow = popup.locator('li', { has: popup.locator('text="Work"') }).first();
    const moveBtn = workRow.locator('button:has([data-testid="DriveFileMoveIcon"])').first();
    if (await moveBtn.count() > 0) {
      await moveBtn.click();
      await popup.locator('text=Move Group To Window').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await popup.waitForTimeout(600);
    }
    const png = await capturePopupPng(popup);
    await composeScreenshot(context, png,
      { title: 'Move groups between windows',
        subtitle: 'Relocate an entire tab group with one click. Sync state follows the group.',
        gradient: gradients.pink },
      path.join(OUT_DIR, '04-move-group.png'));
    await popup.close();
    console.log('wrote 04-move-group.png');
  }

  // ── Screenshot 5: bookmark folders in Chrome ────────────────────────────
  {
    // Resolve the container folder id and ensure each group has bookmarks
    // inside, then deep-link chrome://bookmarks into the container folder.
    const probe = await context.newPage();
    await probe.goto(`chrome-extension://${extensionId}/popup.html`);
    await probe.waitForLoadState('networkidle');
    await probe.waitForTimeout(500);

    const containerId = await probe.evaluate(async () => {
      const results = await chrome.bookmarks.search({ title: 'Tab Group Bookmarks' });
      const folder = results.find(r => !r.url);
      return folder ? folder.id : null;
    });

    // Wait until each mock group has its own subfolder with bookmarks populated.
    const expected = ['Work', 'Research', 'Shopping', 'Travel'];
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const ready = await probe.evaluate(async (names) => {
        const children = await chrome.bookmarks.getChildren(
          (await chrome.bookmarks.search({ title: 'Tab Group Bookmarks' })).find(r => !r.url).id
        );
        const folderNames = children.filter(c => !c.url).map(c => c.title);
        return names.every(n => folderNames.includes(n));
      }, expected).catch(() => false);
      if (ready) break;
      await probe.waitForTimeout(500);
    }
    await probe.close();

    const bm = await context.newPage();
    await bm.setViewportSize({ width: 1280, height: 800 });
    const url = containerId ? `chrome://bookmarks/?id=${containerId}` : 'chrome://bookmarks/';
    await bm.goto(url);
    await bm.waitForTimeout(3000);
    const png = await bm.screenshot({ type: 'png', fullPage: false });
    await composeFullViewport(context, png,
      { title: 'Your tab groups, safely stored as bookmarks',
        subtitle: 'Every synced group becomes a folder in Chrome’s bookmark manager — portable and private.',
        gradient: gradients.slate },
      path.join(OUT_DIR, '05-bookmark-folders.png'));
    await bm.close();
    console.log('wrote 05-bookmark-folders.png');
  }

  // ── Promo tile 440x280 ──────────────────────────────────────────────────
  await makePromoTile(context, path.join(OUT_DIR, 'promo-tile-440x280.png'));
  console.log('wrote promo-tile-440x280.png');

  await context.close();
  console.log('done');
}

main().catch(err => { console.error(err); process.exit(1); });
