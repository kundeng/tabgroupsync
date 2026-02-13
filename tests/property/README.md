# Property-Based Testing Infrastructure

This directory contains property-based tests using [fast-check](https://github.com/dubzzz/fast-check) to verify correctness properties defined in the design document.

## Overview

Property-based testing validates universal properties across randomized inputs rather than testing specific examples. Each test runs 100+ iterations with different generated inputs to ensure correctness across all possible scenarios.

## Structure

```
property/
├── arbitraries.ts          # Reusable arbitrary generators
├── testUtils.ts            # Chrome API mocking utilities
├── bookmarks/              # Bookmark-related properties
├── snapshots/              # Snapshot system properties
├── storage/                # Storage and state properties
└── README.md               # This file
```

## Arbitraries

The `arbitraries.ts` file provides reusable generators for:

- **Tab Groups**: `arbitraryTabGroup` - Generates valid Chrome tab groups
- **Tabs**: `arbitraryTab` - Generates valid Chrome tabs
- **Ungrouped Tabs**: `arbitraryUngroupedTab` - Generates tabs with groupId === -1
- **Bookmarks**: `arbitraryBookmark` - Generates bookmark nodes
- **Folders**: `arbitraryBookmarkFolder` - Generates bookmark folders
- **Settings**: `arbitraryGlobalSettings`, `arbitrarySyncSettings` - Generates settings objects
- **Runtime State**: `arbitraryRuntimeMapping` - Generates runtime mappings
- **Snapshots**: `arbitrarySnapshot` - Generates snapshot data

## Test Utilities

The `testUtils.ts` file provides Chrome API mocking utilities:

- **setupBookmarkMocks**: Mock Chrome bookmarks API with in-memory storage
- **setupStorageMocks**: Mock Chrome storage API with in-memory storage
- **setupTabGroupMocks**: Mock Chrome tab groups API
- **setupTabsMocks**: Mock Chrome tabs API
- **setupAllMocks**: Setup all Chrome API mocks at once

## Writing Property Tests

### Test Structure

Each property test should follow this structure:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { arbitraryTabGroup, arbitraryTab } from '../arbitraries';
import { setupAllMocks } from '../testUtils';

/**
 * Property X: [Property Name]
 * 
 * [Property description from design document]
 * 
 * Validates: Requirements X.Y, X.Z
 */

describe('Property X: [Property Name]', () => {
  let mocks: ReturnType<typeof setupAllMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = setupAllMocks({
      initialStorage: {
        'state:settings': {
          containerFolderId: 'container-1',
          autoSync: true,
          // ... other settings
        }
      }
    });
  });

  it('should [property description]', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 20 }),
        async (group, tabs) => {
          // Test implementation
          // 1. Setup
          // 2. Execute operation
          // 3. Verify property holds
        }
      ),
      { numRuns: 100 } // Run 100+ iterations
    );
  }, 30000); // 30 second timeout
});
```

### Test Naming Convention

- File: `property-{number}-{short-name}.test.ts`
- Describe block: `Property {number}: {Full Property Name}`
- Test: `should {property description}`

### Tag Format

Each test file should include a comment block with:

```typescript
/**
 * Property X: [Property Name]
 * 
 * [Full property description from design document]
 * 
 * Validates: Requirements X.Y, X.Z
 */
```

## Running Tests

```bash
# Run all property tests
npm test tests/property

# Run specific property test
npm test tests/property/bookmarks/property-01-sync.test.ts

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## Configuration

Property tests are configured in `vitest.config.ts`:

- **Test Timeout**: 30 seconds (for 100+ iterations)
- **Iterations**: Minimum 100 runs per property (configured via `numRuns`)
- **Environment**: happy-dom (for DOM APIs)

## Best Practices

1. **Use Shared Arbitraries**: Import from `arbitraries.ts` rather than defining inline
2. **Mock Chrome APIs**: Use utilities from `testUtils.ts` for consistent mocking
3. **Clean State**: Always reset mocks in `beforeEach` hooks
4. **Validate Properties**: Focus on universal properties, not specific examples
5. **Timeout**: Set appropriate timeouts for property tests (30s recommended)
6. **Iterations**: Run at least 100 iterations per property test
7. **Documentation**: Include property description and requirement references

## Correctness Properties

All 30 correctness properties from the design document should have corresponding tests:

### Core Sync Properties (1-4)
- Property 1: Tab Group to Bookmark Folder Synchronization
- Property 2: Bookmark Preservation During Tab Operations
- Property 3: Title Synchronization Consistency
- Property 4: Group Deletion Preservation

### State Management Properties (5-7)
- Property 5: Sync Preference Persistence
- Property 6: Runtime and Persisted State Consistency
- Property 7: State Recovery from Corruption

### Sync Control Properties (8-10)
- Property 8: Sync State Transitions
- Property 9: Auto-Sync Behavior
- Property 10: Auto-Sync Preconditions

### Ungrouped Tab Handling Properties (11-13)
- Property 11: Ungrouped Tab Exclusion
- Property 12: Ungrouped Tab Bookmark Preservation
- Property 13: UI Display Filtering

### Folder Management Properties (14-16)
- Property 14: Container Folder Structure Creation
- Property 15: Automatic Folder Structure Recovery
- Property 16: Nested Container Deduplication

### Snapshot System Properties (17-19)
- Property 17: Snapshot Creation and Storage
- Property 18: Snapshot Restoration Round-Trip
- Property 19: Snapshot Cleanup Policy

### Error Handling Properties (20-22)
- Property 20: Sync Operation Error Handling
- Property 21: Permission and Quota Management
- Property 22: Storage Operation Resilience

### Performance Properties (23-26)
- Property 23: Sync Operation Queuing
- Property 24: Change Debouncing
- Property 25: Batch Processing for Large Operations
- Property 26: Memory Management

### Logging Properties (27-30)
- Property 27: Operation Logging Completeness
- Property 28: Error Logging with Context
- Property 29: State Change Logging
- Property 30: Automatic Decision Logging

## Troubleshooting

### Tests Timing Out

If property tests timeout:
1. Reduce `maxLength` in array generators
2. Increase timeout in test (e.g., `30000` → `60000`)
3. Check for infinite loops in test logic

### Flaky Tests

If tests fail intermittently:
1. Ensure mocks are properly reset in `beforeEach`
2. Check for race conditions in async operations
3. Use `fc.assert` with `seed` parameter to reproduce failures

### Mock Issues

If Chrome API mocks aren't working:
1. Verify mocks are setup in `beforeEach`
2. Check that `vi.clearAllMocks()` is called
3. Ensure promise-based implementations are used
