# Tasks: move-group-across-windows

## Overview

Implement a built-in single-group move action across browser windows with sync-safe mapping updates and bounded persistence policy.

## Tasks

- [x] 1. UI and command surface
  - [x] 1.1 Add move action to group UI
    - Add move trigger in `GroupSection` and new `MoveGroupDialog`
    - List eligible target windows with labels
    - **Depends**: —
    - **Requirements**: 1.1, 4.1

  - [x] 1.2 Add background command route for move
    - Add `MOVE_GROUP_TO_WINDOW` message handling and input validation
    - **Depends**: 1.1
    - **Requirements**: 1.2, 4.2

- [x] 2. Move orchestration in core logic
  - [x] 2.1 Implement `TabGroupManager.moveGroupToWindow`
    - Move tabs, recreate group in target window, restore title/color
    - Return `{ targetGroupId, movedTabCount }`
    - **Depends**: 1.2
    - **Requirements**: 1.2, 1.3

  - [x] 2.2 Update logical mapping + trigger sync
    - Update mapping `currentGroupId` and queue sync reconciliation
    - **Depends**: 2.1
    - **Requirements**: 1.4, 2.1

  - [x] 2.3 Handle partial failure recovery
    - Structured errors, preserve recoverable mapping, trigger reconciliation path
    - **Depends**: 2.1
    - **Requirements**: 1.5, NF 1.2

- [x] 3. Sync race/regression protection
  - [x] 3.1 Add/adjust move-aware sync guards
    - Ensure move event storms do not create duplicate folders/mappings
    - **Depends**: 2.2
    - **Requirements**: 2.2, NF 1.1

  - [x] 3.2 Verify cross-window portability behavior
    - Ensure implementation uses standard APIs only (Chrome + Edge)
    - **Depends**: 2.1
    - **Requirements**: 2.3

- [x] 4. Minimal persistence and retention policy
  - [x] 4.1 Enforce persisted-state minimums
    - Keep global settings, logical mapping, per-group enablement, latest sync status
    - Mark retry counters/in-flight details as transient
    - **Depends**: —
    - **Requirements**: 3.1, 3.2

  - [x] 4.2 Implement bounded history retention
    - Ring buffer cap (default 200) and age pruning (default 7 days)
    - **Depends**: 4.1
    - **Requirements**: 3.3, 3.4

- [x] 5. Tests
  - [x] 5.1 Unit tests for move orchestration and failure recovery
    - **Depends**: 2.3
    - **Requirements**: 1.2, 1.3, 1.5
    - **Properties**: 1, 2

  - [x] 5.2 Unit tests for retention policy bounds
    - **Depends**: 4.2
    - **Requirements**: 3.3, 3.4
    - **Properties**: 3

  - [x] 5.3 E2E move-group-across-windows flow
    - Move group to another window, verify group + mapping + sync continuity
    - **Depends**: 3.2, 5.1
    - **Requirements**: 1.1, 1.4, 2.1, 4.3

- [x] 6. Human-friendly window identification
  - [x] 6.1 Implement `windowLabelBuilder` utility
    - Create `src/lib/utils/windowLabelBuilder.ts`
    - Pure function: `buildWindowLabels(windows, tabGroups) → WindowLabel[]`
    - Label tiers: group names → active tab title/domain → "Window — N tabs"
    - Attach `isFocused` and `tabCount` per window
    - Cap displayed group names to avoid excessive label length
    - **Depends**: —
    - **Requirements**: 5.1, 5.2, 5.3, 5.5
    - **Properties**: 4

  - [x] 6.2 Update `MoveGroupDialog` to use human-friendly labels
    - Switch from `populate: false` to `populate: true` in `chrome.windows.getAll`
    - Query `chrome.tabGroups.query({})` to get all tab groups
    - Call `buildWindowLabels` and render labels instead of raw window IDs
    - Add focused-window visual indicator (e.g., chip/badge)
    - Show tab count as secondary info
    - **Depends**: 6.1
    - **Requirements**: 5.1, 5.2, 5.3, 5.4
    - **Properties**: 4

  - [x] 6.3 Write unit tests for `windowLabelBuilder`
    - Cover: windows with groups, windows without groups (active tab fallback), windows with no useful info (generic fallback), focused state, long group lists truncation
    - **Depends**: 6.1
    - **Requirements**: 5.1, 5.2, 5.3, 5.4
    - **Properties**: 4

  - [x] 6.4 Update E2E test for move dialog window labels
    - Verify move dialog shows meaningful labels (not raw IDs)
    - **Depends**: 6.2, 6.3
    - **Requirements**: 5.1, 5.4

## Notes

- Start with single-group move to keep risk low.
- Keep UI deterministic and disable duplicate submit while move is in progress.
- Ensure compatibility with existing sw-reliability fixes.
- Window labels use group names as primary identifier since this extension is fundamentally about tab groups.
