# Tasks: sw-reliability

## Overview

Fix critical production reliability bugs in the Chrome MV3 service worker. Phases: (1) alarm-based sync, (2) robust folder resolution, (3) light self-recovery, (4) sync efficiency, (5) observability, (6) E2E tests.

## Tasks

- [ ] 1. Persistent periodic sync via chrome.alarms
  - [x] 1.1 Add `alarms` permission to manifest.json
    - Add `"alarms"` to the permissions array in `manifest.json`
    - **File**: `manifest.json`
    - **Depends**: —
    - _Requirements: 1.1, NF 1.2_

  - [x] 1.2 Replace `setInterval` with `chrome.alarms` in background.ts
    - Remove `setInterval` from `startPeriodicSync()`
    - Create `chrome.alarms.create('periodic-sync', { periodInMinutes: 5 })` during initialization
    - Add `chrome.alarms.onAlarm.addListener` that calls `syncAll()` on `periodic-sync` alarm
    - Update alarm when sync interval setting changes
    - **File**: `src/background.ts`
    - **Depends**: 1.1
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [x] 1.3 Add `ensureInitialized()` reentrant guard
    - Create `ensureInitialized()` that checks `isReady`, re-initializes if needed, deduplicates concurrent calls via shared promise
    - Replace all `if (!isReady) { sendResponse({ error }); return; }` blocks in message handlers with `await ensureInitialized()` calls
    - Call `ensureInitialized()` in alarm listener before `syncAll()`
    - **File**: `src/background.ts`
    - **Depends**: 1.2
    - _Requirements: 1.3, 3.2, 3.4_

  - [x] 1.4 Write property test for alarm persistence (Property 1)
    - Verify alarm is created on init, listener handles wake-up, sync runs after alarm fires
    - **File**: `tests/property/reliability/property-alarm-persistence.test.ts`
    - **Depends**: 1.2
    - _Properties: 1_

- [ ] 2. Robust container folder resolution
  - [x] 2.1 Add `containerFolderName` field to GlobalSettings
    - Add `containerFolderName?: string` to `GlobalSettings` interface
    - Set it alongside `containerFolderId` in `setupTabGroupsFolder` and `createContainerFolder`
    - Update `validateGlobalSettings` to accept the new field
    - **Files**: `src/lib/types/storage.ts`, `src/lib/bookmarks/bookmarkManager.ts`, `src/lib/utils/validators.ts`
    - **Depends**: —
    - _Requirements: 2.7_

  - [x] 2.2 Add `resolveContainerFolder()` with three-tier resolution
    - Tier 1: Try stored ID with 3 retries (500ms backoff)
    - Tier 2: If ID not found, search by signature (`"Tab Group Bookmarks"` + `"Tab Group Snapshots"` children) using stored name
    - Tier 3: If API errors on all retries, mark `'unverified'` and preserve config
    - Return `'exists' | 'relocated' | 'deleted' | 'unverified'`
    - Replace current `performMaintenance` folder check and `getTabGroupsFolder` error handling
    - **File**: `src/lib/storage/storageManager.ts`
    - **Depends**: 2.1
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 2.3 Write property test for container folder resolution (Property 2)
    - Randomized scenarios: ID valid, ID invalid but signature found, API errors, genuine deletion
    - Verify config preserved on errors, updated on relocation, cleared only on confirmed deletion
    - **File**: `tests/property/reliability/property-folder-resolution.test.ts`
    - **Depends**: 2.2
    - _Properties: 2_

- [ ] 3. Service worker self-recovery
  - [ ] 3.1 Add bounded recovery alarm on initialization failure
    - After 3 retries in `initializeWithRetry`, schedule ONE `chrome.alarms.create('retry-init', { delayInMinutes: 1 })` — then stop
    - Handle `retry-init` in alarm listener: attempt init, clear alarm on success
    - Do NOT loop — `ensureInitialized` provides on-demand recovery for future events
    - **File**: `src/background.ts`
    - **Depends**: 1.2, 1.3
    - _Requirements: 3.1, 3.5_

  - [ ] 3.2 Add `unhandledrejection` listener (log only)
    - Add `self.addEventListener('unhandledrejection', ...)` that logs error with stack trace
    - No automatic recovery — `ensureInitialized` handles that on next event
    - **File**: `src/background.ts`
    - **Depends**: —
    - _Requirements: 3.3_

  - [ ] 3.3 Write property test for bounded self-recovery (Property 3)
    - Mock init to fail N times then succeed, verify at most 4 attempts (3 immediate + 1 alarm), then recovery via `ensureInitialized`
    - **File**: `tests/property/reliability/property-self-recovery.test.ts`
    - **Depends**: 3.1
    - _Properties: 3_

- [ ] 4. Sync efficiency
  - [ ] 4.1 Add `persistToStorage` option to `addHistoryEntry`
    - Add optional `{ persistToStorage?: boolean }` parameter to `StorageManager.addHistoryEntry`
    - When `false`, add entry to in-memory history array but skip `chrome.storage.sync` write
    - Default to `true` for backward compatibility
    - **File**: `src/lib/storage/storageManager.ts`
    - **Depends**: —
    - _Requirements: 4.1_

  - [ ] 4.2 Skip storage writes for no-change syncs
    - In `syncGroupToFolder`, replace the `currentHash === lastHash` early-return path:
      - Remove `updateMapping` call (no status update needed)
      - Change `addHistoryEntry` to use `{ persistToStorage: false }` with details `"Synced, no changes"`
    - **File**: `src/lib/sync/syncEngine.ts`
    - **Depends**: 4.1
    - _Requirements: 4.1_

  - [ ] 4.3 Write property test for no-change sync idempotency (Property 4)
    - Track `chrome.storage.sync` write calls, verify zero writes when hash unchanged
    - Verify in-memory history contains "Synced, no changes" entry
    - **File**: `tests/property/reliability/property-no-change-sync.test.ts`
    - **Depends**: 4.2
    - _Properties: 4_

- [ ] 5. Observability
  - [ ] 5.1 Add wake-up trigger logging to background.ts
    - Log at top of alarm listener: `{ trigger: 'alarm', alarm: alarm.name }`
    - Log at top of onMessage listener: `{ trigger: 'message', type: message.type }`
    - Record `workerStartTime` at module load, log `timeSinceWorkerStart` in events
    - **File**: `src/background.ts`
    - **Depends**: 1.2
    - _Requirements: NF 2.1, NF 2.2_

  - [ ] 5.2 Add startup event logging to tab group listeners
    - Log event type, group count, and `timeSinceWorkerStart` for tab group created/updated events
    - Helps diagnose Edge workspace bulk-load behavior
    - **File**: `src/listeners/tabGroupListeners.ts`
    - **Depends**: —
    - _Requirements: NF 2.3_

  - [ ] 5.3 Write property test for backward compatibility (Property 5)
    - Seed storage with current-format data (no `containerFolderName`), run new initialization, verify all data preserved and name populated on first resolution
    - **File**: `tests/property/reliability/property-backward-compat.test.ts`
    - **Depends**: 2.2
    - _Properties: 5_

  - [ ] 5.4 Write reliability stress test (Property 6)
    - Use fast-check to generate random sequences of sync events: group created, updated, removed, renamed, alarm fires, worker restart
    - Feed events through mocked SyncEngine + StorageManager + BookmarkManager
    - Collect structured logs of all operations
    - Assert: no unhandled exceptions, no `isReady` stuck false, no silent data loss
    - **File**: `tests/property/reliability/property-stress-test.test.ts`
    - **Depends**: 1.3, 2.2, 3.1
    - _Properties: 6_

- [ ] 6. E2E Tests
  - [ ] 6.1 E2E — periodic sync survives worker idle
    - Create and sync a group, wait for alarm interval, verify sync still works after idle period
    - **File**: `tests/e2e/sw-reliability.test.ts`
    - **Depends**: 1.2, 1.3
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 6.2 E2E — storage location persists across extension reload
    - Configure storage location, reload extension, verify location is preserved and sync resumes
    - **File**: `tests/e2e/sw-reliability.test.ts`
    - **Depends**: 2.2
    - _Requirements: 2.1, 2.3, 2.4_

  - [ ] 6.3 E2E — extension recovers from initialization failure
    - Verify extension processes messages after worker restart (simulated via extension reload)
    - **File**: `tests/e2e/sw-reliability.test.ts`
    - **Depends**: 3.1
    - _Requirements: 3.1, 3.2, 3.5_

## Notes

- `chrome.alarms` has a minimum interval of 1 minute (Chrome enforces this). Current 5-minute periodic sync is fine.
- `ensureInitialized()` must be reentrant — concurrent calls await the same promise, no double-init
- The `activate` event handler in background.ts has redundant re-initialization logic — simplify to use `ensureInitialized()` once that exists
- Property tests for this spec go in `tests/property/reliability/`
- Bookmark IDs are local to each Chrome profile — they change when bookmarks sync across devices. The signature-based search handles this.
