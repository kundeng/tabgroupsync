import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Extended test fixtures for Chrome extension testing
 * 
 * This provides:
 * - context: A browser context with the extension loaded
 * - extensionId: The ID of the loaded extension
 */

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
  extensionPage: Page;
};

export const test = base.extend<ExtensionFixtures>({
  // Override context to load the extension
  context: async ({ }, use, testInfo) => {
    const pathToExtension = path.join(process.cwd(), 'dist');
    
    // Verify extension is built
    if (!fs.existsSync(path.join(pathToExtension, 'manifest.json'))) {
      throw new Error('Extension not built. Run "npm run build" first.');
    }
    
    // Use unique user data directory per worker
    const userDataDir = path.join(process.cwd(), '.playwright-chrome-data', `worker-${testInfo.workerIndex}`);
    
    // Ensure clean user data directory
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    fs.mkdirSync(userDataDir, { recursive: true });
    
    // Launch browser with extension
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--no-first-run',
      ],
    });
    
    // Wait a bit for extension to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await use(context);
    await context.close();
    
    // Cleanup
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  },

  // Extract extension ID from the loaded extension
  extensionId: async ({ context }, use) => {
    // Try multiple methods to get the extension ID
    
    // Method 1: Check for service workers
    let [serviceWorker] = context.serviceWorkers();
    if (serviceWorker) {
      const extensionId = serviceWorker.url().split('/')[2];
      await use(extensionId);
      return;
    }
    
    // Method 2: Navigate to chrome://extensions and extract ID
    const page = await context.newPage();
    await page.goto('chrome://extensions');
    
    // Wait a bit for the page to load
    await page.waitForTimeout(2000);
    
    // Try to extract extension ID from the page
    const extensionId = await page.evaluate(() => {
      const manager = document.querySelector('extensions-manager');
      if (!manager || !manager.shadowRoot) return null;
      
      const itemList = manager.shadowRoot.querySelector('extensions-item-list');
      if (!itemList || !itemList.shadowRoot) return null;
      
      const items = itemList.shadowRoot.querySelectorAll('extensions-item');
      if (items.length === 0) return null;
      
      // Get the first extension's ID
      const firstItem = items[0] as any;
      return firstItem.id;
    });
    
    await page.close();
    
    if (!extensionId) {
      throw new Error('Could not extract extension ID. Extension may not have loaded.');
    }
    
    await use(extensionId);
  },

  // Provide a page for extension testing
  extensionPage: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
