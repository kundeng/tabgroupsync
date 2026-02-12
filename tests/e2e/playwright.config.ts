import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';

const projectRoot = resolve(__dirname, '../..');

/**
 * Playwright configuration for Chrome extension E2E testing
 * 
 * This configuration sets up Playwright to test the Tab Group Sync extension
 * in isolated Chrome browser contexts with the extension loaded.
 */
export default defineConfig({
  testDir: '.',
  
  // Maximum time one test can run
  timeout: 60000,
  
  // Run tests in files in parallel
  fullyParallel: true,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Limit workers to avoid too many Chrome instances
  workers: process.env.CI ? 1 : 2,
  
  // Reporter to use
  reporter: [
    ['html', { outputFolder: resolve(projectRoot, 'playwright-report') }],
    ['list']
  ],
  
  // Shared settings for all the projects below
  use: {
    // Base URL for the extension (will be set dynamically per test)
    baseURL: 'chrome-extension://',
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
    
    // Video on failure
    video: 'retain-on-failure',
  },

  // Configure projects for Chrome with extension support
  projects: [
    {
      name: 'chrome-extension',
      use: {
        ...devices['Desktop Chrome'],
        // Chrome-specific settings for extension testing
        channel: 'chrome',
        // Extensions require a persistent context
        launchOptions: {
          args: [
            // Load extension from dist directory
            `--disable-extensions-except=${projectRoot}/dist`,
            `--load-extension=${projectRoot}/dist`,
            // Disable some Chrome features that might interfere with testing
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-component-extensions-with-background-pages',
            '--disable-dev-shm-usage',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-renderer-backgrounding',
            '--enable-features=NetworkService,NetworkServiceInProcess',
            '--force-color-profile=srgb',
            '--metrics-recording-only',
            '--mute-audio',
          ],
        },
      },
    },
  ],
});
