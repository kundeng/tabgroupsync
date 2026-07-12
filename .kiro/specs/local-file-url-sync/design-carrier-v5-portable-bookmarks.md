# Carrier v5 — Portable bookmark restore + retire path-mapping UI

Status: **in progress** (2026-07-12). Extends v4 (sibling model). Independent of
the live-tab carrier — this is about the OTHER transport: saved tab-group
**bookmark folders**.

## Problem
Tab groups are backed up to bookmark folders. On save, `file://` tab URLs are
canonicalized — but **only via manual path-mapping rules** (`canonicalize(url,
config)`). With **no rules (zero-config), the raw machine-specific path is stored**
(`file:///home/kundeng/…`), so restoring on a different-home machine (a Mac at
`/Users/kundeng/…`) opens the **wrong path**. The carrier already solved this for
live tabs via home-swap; the bookmark transport never got it.

## Fix (Q1) — home-swap on restore, zero-config
Reuse the carrier's home normalization on the **restore** side so saved `file://`
bookmarks are portable without rules:
- New shared `localizeFileUrl(fileUrl, localHome, config, localOs)` in `pathMapper`:
  1. manual rule (`localize`) if one matches — explicit config wins;
  2. else **home-swap** the detected source-home prefix → this machine's
     `localHome` (`/home/<u>` ⇄ `/Users/<u>` ⇄ `/C:/Users/<u>`, cross-username);
  3. else infer this machine's home from OS + source username (bootstrap);
  4. else the raw absolute path (still valid on a same-layout peer).
- `carrierToFileUrl`'s absolute branch is refactored to call it (DRY — identical logic).
- Bookmarks stay stored as `file://` (NOT rewritten to https) — only reopening
  applies the swap. Bookmark sync already carries `file://` fine (Edge bookmark
  sync ≠ Workspace sync).
- Wire `localizeFileUrl` into every restore/open path that currently calls the
  rule-only `localize`: `GroupSection`, `SearchBar`, `Settings`, and the
  `RESTORE_GROUP_FROM_BOOKMARKS` background handler. Each needs `localHome`
  (from `storage.local`) + `localOs` (from `navigator`).

## Then (Q2) — retire the path-mapping UI
Once home-swap is the universal mechanism (carrier decode AND bookmark restore),
manual per-machine rules are pointless for the common case. Remove the
**path-mapping Settings UI**, but KEEP `localize()` + the `rules` fallback in code
for exotic non-home paths (so power users / migrations still work if rules exist
in storage).

## Explicitly KEPT (not obsolete)
- The bookmark **restore menu** ("Restore all / Add missing / Add file:// tabs
  only / Replace") — restores *closed* groups, a separate feature from the carrier.
- Snapshots, core bookmark tab-group sync.

## Checklist
- [ ] `localizeFileUrl()` in pathMapper + refactor `carrierToFileUrl` to use it
- [ ] unit tests (rule-wins, home-swap, OS-inference, raw fallback)
- [ ] wire into GroupSection / SearchBar / Settings / background restore
- [ ] retire path-mapping Settings UI (keep fallback logic)
- [ ] build + full suite green
