# Design: move-group-across-windows

## Tech Stack
- **Language**: TypeScript
- **Framework**: React 18 + Chrome Extension MV3
- **Testing**: Vitest + Playwright
- **APIs**: `chrome.windows`, `chrome.tabs`, `chrome.tabGroups`, `chrome.storage`

## Directory Structure

```text
src/
  components/
    GroupSection.tsx              # add move action UI
    MoveGroupDialog.tsx           # new destination picker dialog
  lib/
    tabGroupManager.ts            # move orchestration entry
    sync/syncEngine.ts            # mapping consistency hooks
    storage/storageManager.ts     # bounded history/retention helpers
  background.ts                   # message route for move command

tests/
  unit/
    tabGroupManager.move.test.ts
    storage/retention-policy.test.ts
  e2e/
    move-group-across-windows.test.ts
```

## Architecture Overview

```mermaid
graph TD
    A[Popup UI: Move Action] --> B[background onMessage]
    B --> C[TabGroupManager.moveGroupToWindow]
    C --> D[Chrome tabs/tabGroups/windows APIs]
    C --> E[StorageManager mapping update]
    C --> F[SyncEngine queue sync]
```

## Module Design

### MoveGroupDialog (new)
- **Purpose**: Let user pick a destination window for a selected group.
- **Inputs**: source group name/id
- **Outputs**: target window id submission
- **States**: loading windows, ready, submitting, error

### TabGroupManager.moveGroupToWindow (new)
- **Purpose**: Orchestrate group move across windows and preserve logical group identity.
- **Signature (proposed)**:
  ```ts
  moveGroupToWindow(params: {
    sourceGroupId: number;
    sourceGroupName: string;
    targetWindowId: number;
  }): Promise<{ targetGroupId: number; movedTabCount: number }>;
  ```
- **Steps**:
  1. Read tabs in source group
  2. Move tabs to target window
  3. Recreate group in target window
  4. Apply original title/color
  5. Update mapping with new `currentGroupId`
  6. Queue sync

### Background message route (extension service worker)
- **Purpose**: Accept UI move command and call manager method safely.
- **Command (proposed)**: `MOVE_GROUP_TO_WINDOW`
- **Validation**: verify group exists and target window is eligible.

### Storage retention policy additions
- **Purpose**: enforce bounded persistence.
- **Policy**:
  - Persist latest status only per mapping
  - History ring buffer (default 200 entries)
  - Optional age pruning (default 7 days)

## Data Flow

```mermaid
sequenceDiagram
    participant U as User
    participant P as Popup UI
    participant B as Background
    participant T as TabGroupManager
    participant C as Chrome APIs
    participant S as Storage/Sync

    U->>P: Choose destination window
    P->>B: MOVE_GROUP_TO_WINDOW
    B->>T: moveGroupToWindow(...)
    T->>C: query/move tabs, group tabs, update group metadata
    T->>S: update mapping + queue sync
    T-->>B: result
    B-->>P: success/failure
```

## State Management

### Persistent (required)
- Group logical mapping (name, folderId, currentGroupId, syncEnabled)
- Global settings
- Latest sync status per group

### Transient (non-persistent)
- Retry counters
- In-flight move operation flags
- Detailed per-step debug event timeline

## Error Handling Strategy
- On partial move failure:
  - return structured error to UI
  - keep mapping recoverable (do not delete mapping)
  - trigger resync to reconcile state
- On target window invalid/closed:
  - abort safely with actionable error

## Testing Strategy
- **Unit tests**:
  - move orchestration success/failure branches
  - retention pruning behavior
- **E2E tests**:
  - move group between windows and verify sync continuity
  - prevent duplicate move submissions
  - move under rapid event churn
- **Commands**:
  - `npm test`
  - `npx playwright test --config tests/e2e/playwright.config.ts -g "move group"`

## Constraints
- Must operate with standard Chrome/Edge extension APIs (no Edge-only workspace API dependency)
- Keep existing sync behavior compatible
- Avoid introducing duplicate folder creation regressions

## Correctness Properties

### Property 1: Logical Identity Preservation
- **Statement**: For any successful move, the logical group mapping remains the same entity and only runtime group ID changes.
- **Validates**: Requirement 1.4, 2.1

### Property 2: No Duplicate Folder Side Effects
- **Statement**: For any move followed by sync, at most one active destination folder mapping exists for the logical group.
- **Validates**: Requirement 2.2, NF 1.1

### Property 3: Bounded Persistence
- **Statement**: For any long-running workload, persisted history remains within configured caps.
- **Validates**: Requirement 3.3, 3.4

## Edge Cases
- Target window closes during move
- Source group changes while operation in progress
- Some tabs fail to move due to browser constraints
- Group renamed immediately after move

## Decisions
- Use single-group move first, not bulk operations
- Keep retry/details transient by default
- Implement bounded history retention to reduce sync storage pressure

## Security Considerations
- Do not log sensitive tab data beyond URL/title already handled by existing sync policy
- Validate message payloads to prevent malformed move requests
