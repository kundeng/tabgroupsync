# Requirements Document

## Introduction

Users need a built-in way to move a tab group to another window (including Edge workspace windows) without relying on third-party extensions. The feature must preserve sync behavior and avoid unnecessary persistent storage growth in MV3 service-worker conditions.

## Glossary

- **Source_Window**: Window currently containing the selected tab group
- **Target_Window**: Destination window chosen by the user
- **Logical_Group**: Group identity tracked by name/settings/mapping independent of transient browser group IDs
- **Transient_State**: Runtime-only state that can be safely dropped on worker restart

## Requirements

### Requirement 1: Move Group Across Windows

**User Story:** As a user, I want to move a tab group to another window, so I can organize my workspaces without an external plugin.

#### Acceptance Criteria

1. WHEN the user requests a move, THE extension SHALL list eligible target windows (excluding the source window by default)
2. WHEN the user selects a target window, THE extension SHALL move all tabs in the selected group to that window
3. WHEN tabs are moved, THE extension SHALL preserve group title and color in the target window
4. WHEN move completes, THE extension SHALL update the group mapping to the new runtime group ID
5. WHEN move fails partially, THE extension SHALL report a clear error and preserve a recoverable sync state

### Requirement 2: Sync Consistency After Move

**User Story:** As a user, I want bookmark sync to remain correct after moving groups between windows, so backups do not fork or duplicate unexpectedly.

#### Acceptance Criteria

1. WHEN a moved group is synced, THE Sync_Engine SHALL continue using the same logical mapping/folder unless user intent requires rename behavior
2. WHEN move triggers tab/group events, THE system SHALL avoid duplicate folder creation and race-condition side effects
3. WHEN target window is in a different Edge workspace, THE behavior SHALL still operate through standard window/tab-group APIs

### Requirement 3: Minimal Persistent State Policy

**User Story:** As a developer, I want only necessary state persisted, so MV3 restart resilience is preserved without storage bloat.

#### Acceptance Criteria

1. THE system SHALL persist only essential control-plane state: global settings, per-group sync preference, logical mapping, and latest sync status
2. Retry counters and high-churn operational details SHALL be treated as transient unless explicitly required for correctness
3. History/event persistence SHALL be bounded by max entries and/or age-based pruning
4. Documentation SHALL define retention defaults and pruning behavior

### Requirement 4: UX and Safety

**User Story:** As a user, I want a fast and understandable move flow, so I can trust outcomes.

#### Acceptance Criteria

1. WHEN no eligible target windows exist, THE UI SHALL show a clear guidance message instead of a broken action
2. WHEN a move is in progress, THE UI SHALL prevent duplicate move submissions for the same group
3. WHEN move succeeds, THE UI SHALL show destination confirmation

## Non-Functional

**NF 1: Reliability**

1. Move operations SHALL be idempotent with respect to sync mapping (no duplicate mappings/folders)
2. Service worker restarts during move SHALL not leave unrecoverable state

**NF 2: Performance**

1. Moving a typical group (<= 20 tabs) SHALL complete within a user-acceptable interaction window under normal browser conditions

### Requirement 5: Human-Friendly Window Identification

**User Story:** As a user, I want to recognize target windows by meaningful labels instead of opaque numeric IDs, so I can confidently pick the right destination.

#### Acceptance Criteria

1. WHEN the move dialog lists eligible windows, THE UI SHALL label each window primarily by the tab group names it contains (comma-separated)
2. WHEN a window contains no tab groups, THE UI SHALL fall back to showing the active tab's title or domain
3. WHEN a window has neither groups nor a resolvable active tab, THE UI SHALL display a generic label with tab count (e.g., "Window — 3 tabs")
4. WHEN the currently focused window is listed, THE UI SHALL visually distinguish it (e.g., a "focused" badge or indicator)
5. WHEN window data is queried, THE system SHALL use `chrome.windows.getAll({ populate: true })` and `chrome.tabGroups.query` to build labels without requiring additional permissions

## Out of Scope

- Bulk moving multiple groups in one action
- Drag-and-drop workspace UI redesign
- Cross-profile or cross-device live tab movement
