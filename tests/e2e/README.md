# E2E Tests for Tab Group Sync Extension

This directory contains end-to-end tests for the Tab Group Sync Chrome extension using Playwright.

## Overview

E2E tests validate the extension's behavior in a real Chrome browser environment with:
- Actual Chrome extension APIs
- Real bookmark and tab group operations
- Isolated browser profiles for each test
- Full extension lifecycle testing

## Running Tests

### Prerequisites

1. Build the extension:
   ```bash
   npm run build
   ```

2. Install Playwright browsers (first time only):
   ```bash
   npx playwright install chromium
   ```

### Test Commands

```bash
# Run all E2E tests
npm run test:e2e

# Run tests with UI mode (interactive)
npm run test:e2e:ui

# Run tests in headed mode (see browser)
npm run test:e2e:headed

# Debug tests
npm run test:e2e:debug

# Run specific test file
npx playwright test tests/e2e/smoke.test.ts
```

## Test Structure

```
tests/e2e/
├── fixtures.ts          # Custom Playwright fixtures for extension testing
├── utils.ts             # Helper functions for common operations
├── smoke.test.ts        # Smoke tests to verify setup
├── tab-group-sync.test.ts    # Core sync functionality tests
├── container-folder.test.ts  # Folder management tests
├── snapshots.test.ts         # Snapshot system tests
└── README.md            # This file
```

## Writing Tests

### Basic Test Structure

```typescript
import { test, expect } from './fixtures';
import { openExtensionPopup } from './utils';

test('should sync tab group to bookmarks', async ({ page, extensionId }) => {
  // Open extension popup
  await openExtensionPopup(page, extensionId);
  
  // Perform test actions
  // ...
  
  // Assert expected behavior
  expect(/* ... */).toBe(/* ... */);
});
```

### Available Fixtures

- `context`: Browser context with extension loaded
- `extensionId`: The ID of the loaded extension
- `page`: A page in the extension context

### Helper Functions

See `utils.ts` for available helper functions:
- `openExtensionPopup()`: Opens the extension popup
- `createTabGroup()`: Creates a new tab group
- `getBookmarksInFolder()`: Gets bookmarks in a folder
- `findBookmarkFolder()`: Finds a bookmark folder by title
- `waitForBookmarkFolder()`: Waits for a folder to be created
- And more...

## Test Isolation

Each test runs in an isolated browser context with:
- Fresh extension installation
- Clean bookmark state
- Separate user data directory
- No shared state between tests

## Debugging

### Visual Debugging

Run tests in headed mode to see the browser:
```bash
npm run test:e2e:headed
```

### Interactive Debugging

Use Playwright's debug mode:
```bash
npm run test:e2e:debug
```

This opens the Playwright Inspector where you can:
- Step through test actions
- Inspect page state
- View console logs
- Take screenshots

### Screenshots and Videos

Failed tests automatically capture:
- Screenshots (in `test-results/`)
- Videos (in `test-results/`)
- Traces (in `test-results/`)

View the HTML report:
```bash
npx playwright show-report
```

## CI/CD Integration

Tests are configured to run in CI with:
- Retries on failure (2 retries)
- Sequential execution (no parallel)
- Automatic artifact collection

## Troubleshooting

### Extension Not Loading

If the extension doesn't load:
1. Ensure `npm run build` completed successfully
2. Check that `dist/` directory exists and contains manifest.json
3. Verify Chrome/Chromium is installed

### Tests Timing Out

If tests timeout:
1. Increase timeout in `playwright.config.ts`
2. Check for async operations that don't complete
3. Verify extension background service worker is running

### Chrome API Errors

If Chrome APIs are unavailable:
1. Ensure extension has required permissions in manifest.json
2. Check that extension is loaded in the correct context
3. Verify service worker is active

## Best Practices

1. **Build before testing**: Always run `npm run build` before E2E tests
2. **Use helpers**: Leverage utility functions for common operations
3. **Wait for state**: Use `waitFor*` functions instead of fixed timeouts
4. **Clean state**: Don't rely on state from previous tests
5. **Descriptive names**: Use clear test descriptions
6. **Assertions**: Include meaningful assertions with good error messages

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Chrome Extension Testing Guide](https://playwright.dev/docs/chrome-extensions)
- [Chrome Extension APIs](https://developer.chrome.com/docs/extensions/reference/)
