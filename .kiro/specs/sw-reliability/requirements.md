# Requirements Document

## Introduction

The Tab Group Sync Chrome extension has critical reliability issues in production Chrome/Edge. The MV3 service worker is terminated after ~30 seconds of inactivity, which destroys in-memory state (`setInterval`, sync queues, runtime mappings). Aggressive error handling during initialization permanently wipes user configuration on transient failures. The `containerFolderId` stored in `chrome.storage.sync` is a local bookmark ID that changes across devices, breaking cross-device sync. There is no recovery path when initialization fails. This spec addresses these production bugs.

## Glossary

- **Service_Worker**: The MV3 background script, subject to Chrome's lifecycle management (termination after ~30s inactivity, wake-up on events)
- **Chrome_Alarm**: A persistent timer via `chrome.alarms` API that survives worker termination and wakes the worker when it fires
- **Transient_Failure**: A temporary API error (e.g., bookmarks API not ready during startup) that resolves on retry
- **Container_Folder**: The user-configured bookmark folder that anchors all sync operations. Contains child folders `"Tab Group Bookmarks"` and `"Tab Group Snapshots"`
- **Folder_Signature**: The distinctive structure (two known child folder names) that uniquely identifies the container folder regardless of its bookmark ID
- **Initialization_Deadlock**: State where `isReady = false` permanently, causing all message handlers to return errors

## Requirements

### Requirement 1: Persistent Periodic Sync

**User Story:** As a user, I want sync to resume automatically when I return to the browser after it has been idle, so that my tab group changes are always backed up.

#### Acceptance Criteria

1. WHEN the extension needs periodic sync, THE Background SHALL use `chrome.alarms` instead of `setInterval` to schedule sync operations
2. WHEN the service worker is terminated and later wakes up (via alarm, listener event, or message), THE Background SHALL resume periodic sync automatically
3. WHEN the alarm fires, THE Background SHALL re-initialize managers if needed before performing sync
4. WHEN the user changes the sync interval setting, THE Background SHALL update the alarm schedule accordingly
5. WHEN the extension is first installed or updated, THE Background SHALL create the periodic sync alarm

### Requirement 2: Robust Container Folder Resolution

**User Story:** As a user, I want my configured storage location to work reliably across devices and survive browser restarts, so that I don't have to reconfigure the extension repeatedly.

#### Acceptance Criteria

1. WHEN the stored `containerFolderId` is not found, THE Storage_Manager SHALL search for the container folder by its signature (child folders named `"Tab Group Bookmarks"` and `"Tab Group Snapshots"`) before concluding it is missing
2. WHEN the container folder is found by signature at a different ID, THE Storage_Manager SHALL update `containerFolderId` to the new ID and continue normally
3. WHEN the bookmark API fails transiently during folder verification, THE Storage_Manager SHALL retry up to 3 times before concluding the folder is missing
4. WHEN all retries fail and no folder is found by signature, THE Storage_Manager SHALL mark the folder as "unverified" and preserve `containerFolderId` rather than wiping it
5. WHEN the container folder is genuinely deleted (API succeeds but returns empty), THE Storage_Manager SHALL clear `containerFolderId` and show a clear error in the UI
6. WHEN `containerFolderId` is cleared, THE Storage_Manager SHALL log the reason and the old value
7. WHEN the extension syncs across devices via `chrome.storage.sync`, THE Storage_Manager SHALL store the container folder name alongside the ID so the folder can be relocated on other machines

### Requirement 3: Service Worker Self-Recovery

**User Story:** As a user, I want the extension to recover automatically from crashes, so that I don't have to manually restart it.

#### Acceptance Criteria

1. WHEN initialization fails after max retries (3), THE Background SHALL register a single recovery alarm (60 seconds) for one more attempt — then stop to avoid memory pressure
2. WHEN a message arrives and `isReady` is false, THE Background SHALL attempt one re-initialization before returning an error
3. WHEN an unhandled promise rejection occurs in the service worker, THE Background SHALL log the error with stack trace
4. WHEN the service worker wakes up from any event, THE Background SHALL verify that managers are initialized and re-initialize if needed (`ensureInitialized` guard)
5. WHEN re-initialization succeeds after a previous failure, THE Background SHALL resume normal operation and clear the recovery alarm

### Requirement 4: Sync Efficiency

**User Story:** As a user, I want the extension to avoid unnecessary storage writes and respect Chrome API quotas.

#### Acceptance Criteria

1. WHEN syncing a group with no changes detected (hash unchanged), THE Sync_Engine SHALL record "synced, no changes" in the in-memory history but SHALL NOT write a status update to `chrome.storage.sync`
2. WHEN Chrome API quota errors occur, THE Sync_Engine SHALL re-queue the group with a 60-second delay and retry up to 3 times before dropping it
3. WHEN the sync queue reaches its max size (100), THE Sync_Engine SHALL log a warning with the queue size and the dropped group name, and SHALL NOT enqueue the new item

### Non-Functional

**NF 1: Backward Compatibility**

1. WHEN upgrading from the current version, THE Extension SHALL preserve all existing user settings and sync preferences without data loss
2. WHEN `chrome.alarms` replaces `setInterval`, THE Extension SHALL request the `alarms` permission in `manifest.json`

**NF 2: Observability**

1. WHEN the service worker starts, THE Background SHALL log the wake-up trigger (alarm name, message type, or listener event type)
2. WHEN re-initialization occurs, THE Background SHALL log the trigger and outcome
3. WHEN tab group events fire during startup (especially in Edge with workspaces), THE Background SHALL log the event type, group count, and timing to help diagnose bulk-load behavior

**NF 3: Reliability Stress Testing**

1. THE test suite SHALL include a property test that generates realistic random sequences of sync events (group created, updated, removed, renamed, alarm fires, worker restart) and feeds them through the system
2. THE test SHALL produce structured logs of all operations performed, enabling post-hoc reliability analysis
3. THE test SHALL verify no unhandled exceptions, no permanent deadlocks (`isReady` stuck false), and no silent data loss across the random event sequence

## Out of Scope

- Rewriting the sync engine's core algorithm (tab-to-bookmark mapping)
- Changing the storage format or migrating to IndexedDB
- Adding a persistent background page (not allowed in MV3)
- UI redesign or new user-facing features beyond error messaging
- Adaptive sync delays or priority queuing (current queue + 4s delay is sufficient)
