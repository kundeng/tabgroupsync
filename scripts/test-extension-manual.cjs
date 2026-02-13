#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function launchTest() {
  const extensionPath = path.resolve(__dirname, '..', 'dist');
  const userDataDir = path.join(os.tmpdir(), 'tabgroup-test-' + Date.now());
  
  fs.mkdirSync(userDataDir, { recursive: true });

  // Find Playwright's Chromium
  const playwrightCache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const chromiumDirs = fs.readdirSync(playwrightCache)
    .filter(d => d.startsWith('chromium-'))
    .sort()
    .reverse();
  
  if (chromiumDirs.length === 0) {
    console.error('❌ Playwright Chromium not found. Run: npx playwright install chromium');
    process.exit(1);
  }

  const chromiumPath = path.join(
    playwrightCache,
    chromiumDirs[0],
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  );

  console.log('🚀 Launching Chromium with Tab Group Sync extension...');
  console.log('📁 Extension:', extensionPath);
  console.log('📂 Profile:', userDataDir);
  console.log('🌐 Browser:', chromiumPath);
  console.log('');

  const args = [
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    'chrome://extensions'
  ];

  spawn(chromiumPath, args, { stdio: 'inherit', detached: true });

  console.log('✅ Chromium launched!');
  console.log('');
  console.log('📝 CHECK:');
  console.log('1. Look at chrome://extensions - is the extension loaded?');
  console.log('2. Check for any errors in the extension card');
  console.log('3. Click "Inspect views: service worker" to see console errors');
  console.log('');
  console.log('Close browser manually when done.');
}

launchTest().catch(console.error);
