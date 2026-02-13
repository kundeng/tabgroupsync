# Tasks: sw-reliability

## Overview

Fix critical production reliability bugs in the Chrome MV3 service worker. Phases progress from foundational changes (alarms, resilient storage) through core reliability (self-recovery, batching) to validation (property tests, E2E tests).

## Tasks

- [ ] 1. Persistent periodic sync via chrome.alarms
  - [ ] 1.1 Add `alarms` permission to manifest.json
    - Add `"alarms"` to the permissions array in `manifest.json`
    - **File**: `manifest.json`
    - **Depends**: —
    - _Requirements: 1.1, NF 1.2_

  - [ ] 1.2 Replace `setInterval` with `chrome.alarms` in background.ts
    - Remove `setInterval` from `startPeriodicSync()`
    - Create `chrome.alarms.create('periodic-sync', { periodInMinutes: 5 })` during initialization
    - Add `chrome.alarms.onAlarm.addListener` that calls `syncAll()` on `periodic-sync` alarm
    - Update alarm interval when sync settings change
    - **File**: `src/background.ts`
    - **Depends**: 1.1
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [ ] 1.3 Add `ensureInitialized()` guard function
    - Create reentrant `ensureInitialized()` that checks `isReady`, re-initializes if needed, and deduplicates concurrent calls
    - Replace all `if (!isReady) { sendResponse({ error: ... }); return; }` blocks with `await ensureInitialized()` calls
    - **File**: `src/background.ts`
    - **Depends**: 1.2
    - _Requirements: 1.3, 3.2, 3.4_

  - [ ] 1.4 Write property test for alarm persistence (Property 1)
    - Verify alarm is created on init, listener handles wake-up, sync runs after alarm fires
    - **File**: `tests/property/reliability/property-alarm-persistence.test.ts`
    - **Depends**: 1.2
    - _Properties: 1_

- [ ] 2. Resilient configuration persistence
  - [ ] 2.1 Add `verifyContainerFolder()` with retry logic to StorageManager
    - Replace the single `chrome.bookmarks.get()` call in `performMaintenance` with a retry loop (3 attempts, 500ms backoff)
    - Return `'exists' | 'deleted' | 'unverified'` — only clear `containerFolderId` on `'deleted'`
    - Log the old value before clearing for recovery
    - **File**: `src/lib/storage/storageManager.ts`
    - **Depends**: —
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 2.2 Write property test for configuration survival (Property 2)
    - Randomized failure sequences: verify config preserved on errors, cleared only on confirmed deletion
    - **File**: `tests/property/reliability/property-config-survival.test.ts`
    - **Depends**: 2.1
    - _Properties: 2_

- [ ] 3. Service worker self-recovery
  - [ ] 3.1 Add recovery alarm on initialization failure
    - After max retries in `initializeWithRetry`, create `chrome.alarms.create('retry-init', { delayInMinutes: 1 })`
    - Handle `retry-init` alarm in the alarm listener to retry initialization
    - Clear the alarm once initialization succeeds
    - **File**: `src/background.ts`
    - **Depends**: 1.2, 1.3
    - _Requirements: 3.1, 3.5_

  - [ ] 3.2 Add `unhandledrejection` listener
    - Add `self.addEventListener('unhandledrejection', ...)` that logs the error and schedules recovery if `!isReady`
    - **File**: `src/background.ts`
    - **Depends**: 3.1
    - _Requirements: 3.3_

  - [ ] 3.3 Add message queuing during initialization
    - When `!isReady` and init is in progress, queue the message and process after init completes
    - If init fails, return error to all queued messages
    - **File**: `src/background.ts`
    - **Depends**: 1.3
    - _Requirements: 3.2, 5.2_

  - [ ] 3.4 Write property test for self-recovery convergence (Property 3)
    - Mock init to fail N times then succeed, verify recovery alarm is created and eventually succeeds
    - **File**: `tests/property/reliability/property-self-recovery.test.ts`
    - **Depends**: 3.1, 3.3
    - _Properties: 3, 4_

- [ ] 4. Efficient bulk sync
  - [ ] 4.1 Add `getAllSyncPreferences()` to StorageManager
    - Expose `persistedState.syncPreferences` as a read-only accessor
    - **File**: `src/lib/storage/storageManager.ts`
    - **Depends**: —
    - _Requirements: 4.1_

  - [ ] 4.2 Batch storage reads in `syncAll()`
    - Replace per-group `getMapping()` and `getGroupSyncSettings()` calls with single `getAllMappings()` + `getAllSyncPreferences()` at the top
    - **File**: `src/lib/sync/syncEngine.ts`
    - **Depends**: 4.1
    - _Requirements: 4.1_

  - [ ] 4.3 Remove history write for no-change syncs
    - In `syncGroupToFolder`, remove the `addHistoryEntry` call in the `currentHash === lastHash` early-return path
    - Also remove the `updateMapping` call in that path (no-op status update)
    - **File**: `src/lib/sync/syncEngine.ts`
    - **Depends**: —
    - _Requirements: 4.2_

  - [ ] 4.4 Batch bookmark lookups in `initializeRuntimeMappings()`
    - Load all children of container folder once, build a `Map<name, folder>`, use it for all groups
    - **File**: `src/lib/storage/storageManager.ts`
    - **Depends**: —
    - _Requirements: 5.3_

  - [ ] 4.5 Add adaptive sync delays based on group count
    - In `queueSyncsWithDelay`, increase `SYNC_DELAY` when queue size > 10 groups
    - Log when adaptive delay kicks in
    - **File**: `src/lib/sync/syncEngine.ts`
    - **Depends**: 4.2
    - _Requirements: 4.3, 4.4_

  - [ ] 4.6 Write property test for bulk sync efficiency (Property 5, 6)
    - Count storage API calls during `syncAll` with varying group counts — verify O(1) reads
    - Verify zero storage writes on unchanged sync
    - **File**: `tests/property/reliability/property-bulk-sync.test.ts`
    - **Depends**: 4.2, 4.3
    - _Properties: 5, 6_

- [ ] 5. Startup performance
  - [ ] 5.1 Register event listeners synchronously before async init
    - Move `chrome.runtime.onMessage.addListener`, `chrome.alarms.onAlarm.addListener`, and `chrome.runtime.onConnect.addListener` to top-level synchronous scope
    - Keep handler bodies async but ensure registration happens before `initializeWithRetry()`
    - **File**: `src/background.ts`
    - **Depends**: 1.2, 1.3, 3.3
    - _Requirements: 5.1_

  - [ ] 5.2 Write property test for backward compatibility (Property 7)
    - Seed storage with current-format data, run new initialization, verify all data preserved
    - **File**: `tests/property/reliability/property-backward-compat.test.ts`
    - **Depends**: 2.1, 4.4
    - _Properties: 7_

- [ ] 6. E2E Tests
  - [ ] 6.1 E2E — periodic sync survives worker idle
    - Create and sync a group, wait for alarm interval, verify sync still works after idle period
    - **File**: `tests/e2e/sw-reliability.test.ts`
    - **Depends**: 1.2, 1.3
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 6.2 E2E — storage location persists across restarts
    - Configure storage location, reload extension, verify location is preserved
    - **File**: `tests/e2e/sw-reliability.test.ts`
    - **Depends**: 2.1
    - _Requirements: 2.1, 2.4_

  - [ ] 6.3 E2E — extension recovers from initialization failure
    - Simulate init failure, verify extension recovers and processes messages
    - **File**: `tests/e2e/sw-reliability.test.ts`
    - **Depends**: 3.1, 3.3
    - _Requirements: 3.1, 3.2, 3.5_

## Notes

- `chrome.alarms` has a minimum interval of 1 minute (Chrome enforces this)
- `ensureInitialized()` must be reentrant — concurrent calls should await the same promise
- The `activate` event handler in background.ts has redundant re-initialization logic that duplicates `loadState()` — it should be simplified to use `ensureInitialized()` once that exists
- Property tests for this spec go in `tests/property/reliability/` to keep them separate from the existing `tab-group-sync` property tests
