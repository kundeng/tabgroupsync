# Requirements Document

## Introduction

The Tab Group Sync Chrome extension suffers from critical reliability issues in production Chrome. The MV3 service worker is terminated after ~30 seconds of inactivity, which destroys in-memory state (`setInterval`, sync queues, runtime mappings). Additionally, aggressive error handling during initialization can permanently wipe user configuration, and there is no recovery path when initialization fails after max retries. This spec addresses these production reliability bugs.

## Glossary

- **Service_Worker**: The MV3 background script that runs as a service worker, subject to Chrome's lifecycle management (termination after inactivity, wake-up on events)
- **Worker_Termination**: Chrome automatically terminates the service worker after ~30 seconds of inactivity to conserve resources
- **Chrome_Alarm**: A persistent timer via `chrome.alarms` API that survives worker termination and wakes the worker when it fires
- **Transient_Failure**: A temporary API error (e.g., bookmarks API not ready during startup) that resolves on retry
- **Container_Folder_ID**: The user-configured bookmark folder ID stored in `chrome.storage.sync` that anchors all sync operations
- **Initialization_Deadlock**: State where `isReady = false` permanently, causing all message handlers to return errors

## Requirements

### Requirement 1: Persistent Periodic Sync

**User Story:** As a user, I want my tab groups to keep syncing automatically even after Chrome has been idle, so that my bookmarks stay up to date without manual intervention.

#### Acceptance Criteria

1. WHEN the extension needs periodic sync, THE Background SHALL use `chrome.alarms` instead of `setInterval` to schedule sync operations
2. WHEN the service worker is terminated and restarted by Chrome, THE Background SHALL resume periodic sync automatically via the alarm listener
3. WHEN the alarm fires, THE Background SHALL re-initialize managers if needed before performing sync
4. WHEN the user changes the sync interval setting, THE Background SHALL update the alarm schedule accordingly
5. WHEN the extension is first installed, THE Background SHALL create the periodic sync alarm

### Requirement 2: Resilient Configuration Persistence

**User Story:** As a user, I want my configured storage location to survive browser restarts and transient errors, so that I don't have to reconfigure the extension repeatedly.

#### Acceptance Criteria

1. WHEN `performMaintenance` checks the container folder, THE Storage_Manager SHALL retry the bookmark API call up to 3 times before concluding the folder is missing
2. WHEN all retries fail, THE Storage_Manager SHALL mark the folder as "unverified" rather than immediately wiping `containerFolderId`
3. WHEN the container folder is genuinely deleted by the user, THE Storage_Manager SHALL clear `containerFolderId` and show a clear error in the UI
4. WHEN the extension starts and `containerFolderId` is set, THE Storage_Manager SHALL NOT clear it due to a single transient API failure
5. WHEN `containerFolderId` is cleared, THE Storage_Manager SHALL log the reason and preserve the old value for potential recovery

### Requirement 3: Service Worker Self-Recovery

**User Story:** As a user, I want the extension to recover automatically from crashes and initialization failures, so that I never have to manually restart the extension.

#### Acceptance Criteria

1. WHEN initialization fails after max retries, THE Background SHALL register an alarm to retry initialization periodically (e.g., every 60 seconds) instead of giving up permanently
2. WHEN a message arrives and `isReady` is false, THE Background SHALL attempt re-initialization before returning an error
3. WHEN an unhandled promise rejection occurs in the service worker, THE Background SHALL log the error and attempt recovery rather than leaving the worker in a broken state
4. WHEN the service worker wakes up from any event, THE Background SHALL verify that managers are initialized and re-initialize if needed
5. WHEN re-initialization succeeds after a previous failure, THE Background SHALL resume normal operation including periodic sync

### Requirement 4: Efficient Bulk Sync

**User Story:** As a user with many tab groups, I want the extension to sync efficiently without causing browser lag, so that my browsing experience remains smooth.

#### Acceptance Criteria

1. WHEN `syncAll` runs, THE Sync_Engine SHALL load all settings and mappings in a single `chrome.storage.sync.get(null)` call instead of N individual calls
2. WHEN syncing a group with no changes detected, THE Sync_Engine SHALL NOT write a history entry to storage
3. WHEN multiple groups need syncing, THE Sync_Engine SHALL process them with adaptive delays based on the number of groups (longer delays for larger batches)
4. WHEN the sync queue exceeds a threshold, THE Sync_Engine SHALL log a warning and prioritize recently-changed groups over periodic full syncs
5. WHEN Chrome API quota errors occur, THE Sync_Engine SHALL implement exponential backoff starting at 60 seconds

### Requirement 5: Startup Performance

**User Story:** As a user, I want the extension to start quickly and not block the browser during initialization, so that my browsing is not impacted when Chrome starts.

#### Acceptance Criteria

1. WHEN the service worker starts, THE Background SHALL register event listeners synchronously before any async initialization
2. WHEN initialization is in progress, THE Background SHALL queue incoming messages and process them after initialization completes (instead of returning errors)
3. WHEN `initializeRuntimeMappings` runs, THE Storage_Manager SHALL batch bookmark API calls instead of making one call per group

### Non-Functional

**NF 1: Backward Compatibility**

1. WHEN upgrading from the current version, THE Extension SHALL preserve all existing user settings and sync preferences without data loss
2. WHEN `chrome.alarms` replaces `setInterval`, THE Extension SHALL request the `alarms` permission in `manifest.json`

**NF 2: Observability**

1. WHEN the service worker is terminated, THE Extension SHALL log the termination event (via `beforeunload` or similar)
2. WHEN the service worker wakes up, THE Extension SHALL log the wake-up reason (alarm, message, listener event)
3. WHEN re-initialization occurs, THE Extension SHALL log the trigger and outcome

## Out of Scope

- Rewriting the sync engine's core algorithm (tab-to-bookmark mapping)
- Changing the storage format or migrating to IndexedDB
- Adding a persistent background page (not allowed in MV3)
- UI redesign or new user-facing features beyond error messaging
