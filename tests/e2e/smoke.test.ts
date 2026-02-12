import { test, expect } from './fixtures';
import { openExtensionPopup } from './utils';

/**
 * Smoke tests to verify E2E testing infrastructure is working
 * 
 * These tests validate:
 * - Extension loads correctly
 * - Extension ID can be extracted
 * - Popup can be opened
 * - Basic Chrome APIs are accessible
 */

test.describe('Extension E2E Smoke Tests', () => {
  // New test to check if extension loads without service worker
  test('should load extension page directly', async ({ context, extensionPage }) => {
    // Try to navigate to chrome://extensions to see if extension is loaded
    const pages = context.pages();
    expect(pages.length).toBeGreaterThan(0);
    
    // Check if we can at least create a page
    expect(extensionPage).toBeTruthy();
  });
  
  test('should load the extension', async ({ context, extensionId }) => {
    // Verify extension ID is extracted
    expect(extensionId).toBeTruthy();
    expect(extensionId).toMatch(/^[a-z]{32}$/);
    
    // Verify service worker is running
    const serviceWorkers = context.serviceWorkers();
    expect(serviceWorkers.length).toBeGreaterThan(0);
  });

  test('should open the extension popup', async ({ extensionPage, extensionId }) => {
    // Open popup
    await openExtensionPopup(extensionPage, extensionId);
    
    // Verify popup loaded
    expect(extensionPage.url()).toContain(extensionId);
    expect(extensionPage.url()).toContain('popup.html');
    
    // Verify popup content is visible
    await expect(extensionPage.locator('body')).toBeVisible();
  });

  test('should have access to Chrome APIs', async ({ extensionPage, extensionId }) => {
    await openExtensionPopup(extensionPage, extensionId);
    
    // Test chrome.storage API
    const storageAvailable = await extensionPage.evaluate(() => {
      return typeof chrome !== 'undefined' && 
             typeof chrome.storage !== 'undefined';
    });
    expect(storageAvailable).toBe(true);
    
    // Test chrome.bookmarks API
    const bookmarksAvailable = await extensionPage.evaluate(() => {
      return typeof chrome !== 'undefined' && 
             typeof chrome.bookmarks !== 'undefined';
    });
    expect(bookmarksAvailable).toBe(true);
    
    // Test chrome.tabGroups API
    const tabGroupsAvailable = await extensionPage.evaluate(() => {
      return typeof chrome !== 'undefined' && 
             typeof chrome.tabGroups !== 'undefined';
    });
    expect(tabGroupsAvailable).toBe(true);
  });

  test('should display extension UI', async ({ extensionPage, extensionId }) => {
    await openExtensionPopup(extensionPage, extensionId);
    
    // Wait for React to render
    await extensionPage.waitForTimeout(2000);
    
    // Check for main UI elements (adjust selectors based on actual UI)
    const hasContent = await extensionPage.evaluate(() => {
      return document.body.textContent && document.body.textContent.length > 0;
    });
    expect(hasContent).toBe(true);
  });

  test('should be able to query tab groups', async ({ extensionPage, extensionId }) => {
    await openExtensionPopup(extensionPage, extensionId);
    
    // Query tab groups
    const tabGroups = await extensionPage.evaluate(async () => {
      return await chrome.tabGroups.query({});
    });
    
    // Should return an array (even if empty)
    expect(Array.isArray(tabGroups)).toBe(true);
  });

  test('should be able to query bookmarks', async ({ extensionPage, extensionId }) => {
    await openExtensionPopup(extensionPage, extensionId);
    
    // Query bookmarks
    const bookmarks = await extensionPage.evaluate(async () => {
      return await chrome.bookmarks.getTree();
    });
    
    // Should return bookmark tree
    expect(Array.isArray(bookmarks)).toBe(true);
    expect(bookmarks.length).toBeGreaterThan(0);
  });
});
