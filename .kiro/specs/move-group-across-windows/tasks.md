# Tasks: move-group-across-windows

## Overview

Implement a built-in single-group move action across browser windows with sync-safe mapping updates and bounded persistence policy.

## Tasks

- [ ] 1. UI and command surface
  - [ ] 1.1 Add move action to group UI
    - Add move trigger in `GroupSection` and new `MoveGroupDialog`
    - List eligible target windows with labels
    - **Depends**: —
    - **Requirements**: 1.1, 4.1

  - [ ] 1.2 Add background command route for move
    - Add `MOVE_GROUP_TO_WINDOW` message handling and input validation
    - **Depends**: 1.1
    - **Requirements**: 1.2, 4.2

- [ ] 2. Move orchestration in core logic
  - [ ] 2.1 Implement `TabGroupManager.moveGroupToWindow`
    - Move tabs, recreate group in target window, restore title/color
    - Return `{ targetGroupId, movedTabCount }`
    - **Depends**: 1.2
    - **Requirements**: 1.2, 1.3

  - [ ] 2.2 Update logical mapping + trigger sync
    - Update mapping `currentGroupId` and queue sync reconciliation
    - **Depends**: 2.1
    - **Requirements**: 1.4, 2.1

  - [ ] 2.3 Handle partial failure recovery
    - Structured errors, preserve recoverable mapping, trigger reconciliation path
    - **Depends**: 2.1
    - **Requirements**: 1.5, NF 1.2

- [ ] 3. Sync race/regression protection
  - [ ] 3.1 Add/adjust move-aware sync guards
    - Ensure move event storms do not create duplicate folders/mappings
    - **Depends**: 2.2
    - **Requirements**: 2.2, NF 1.1

  - [ ] 3.2 Verify cross-window portability behavior
    - Ensure implementation uses standard APIs only (Chrome + Edge)
    - **Depends**: 2.1
    - **Requirements**: 2.3

- [ ] 4. Minimal persistence and retention policy
  - [ ] 4.1 Enforce persisted-state minimums
    - Keep global settings, logical mapping, per-group enablement, latest sync status
    - Mark retry counters/in-flight details as transient
    - **Depends**: —
    - **Requirements**: 3.1, 3.2

  - [ ] 4.2 Implement bounded history retention
    - Ring buffer cap (default 200) and age pruning (default 7 days)
    - **Depends**: 4.1
    - **Requirements**: 3.3, 3.4

- [ ] 5. Tests
  - [ ] 5.1 Unit tests for move orchestration and failure recovery
    - **Depends**: 2.3
    - **Requirements**: 1.2, 1.3, 1.5
    - **Properties**: 1, 2

  - [ ] 5.2 Unit tests for retention policy bounds
    - **Depends**: 4.2
    - **Requirements**: 3.3, 3.4
    - **Properties**: 3

  - [ ] 5.3 E2E move-group-across-windows flow
    - Move group to another window, verify group + mapping + sync continuity
    - **Depends**: 3.2, 5.1
    - **Requirements**: 1.1, 1.4, 2.1, 4.3

## Notes

- Start with single-group move to keep risk low.
- Keep UI deterministic and disable duplicate submit while move is in progress.
- Ensure compatibility with existing sw-reliability fixes.
