# Feature Queue

Features the autonomous dev loop works through, in priority order. The loop
picks the top unchecked item, creates `.kiro/specs/<slug>/` if missing, and
advances one step (requirements → design → tasks → code → test → commit) per
iteration. Completed items stay checked for history; delete them to shrink.

## Queue

- [ ] **bookmark-folder-cleanup** — User-facing cleanup feature in popup Settings. Handles (a) duplicate-title folders (union-merge, keep canonical), (b) zero-bookmark orphan folders (detect and offer removal), (c) prefix-chain cruft (from the pre-debounce keystroke bug). All destructive actions require explicit confirmation with preview. Self-heal path: `BookmarkManager.reconcileGroupFolder(name)` called from `ensureGroupFolder` for automatic per-sync healing of duplicates, plus a dedicated "Clean up bookmark folders" button in the Settings dialog that surfaces the batch version.

## Queue rules

- Only the **top unchecked** item is worked on per iteration.
- When all tasks in a spec's `tasks.md` are checked AND tests pass, the queue
  item is checked off.
- If the iteration hits a blocker it can't resolve, it writes a `BLOCKED` entry
  in `progress.txt` and stops advancing that spec until the human unblocks.
- When the queue has no unchecked items, the loop halts itself.
