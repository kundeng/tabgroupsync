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
- [x] `localizeFileUrl()` in pathMapper + refactor `carrierToFileUrl` to use it
- [x] `osFromUserAgent()` shared by SW + popup
- [x] unit tests (rule-wins, home-swap cross-OS + cross-user, OS-inference, raw fallback)
- [x] wire into GroupSection / SearchBar / Settings bulk-open / 3 background restore handlers
- [x] retire path-mapping Settings UI — removed the rules editor + Machine ID input +
      state/effects; KEPT the "Open all file:// tabs" action + FileAccessBanner + the
      `localize()`/`rules` fallback (bulk-open still reads rules from storage). Section
      renamed "Path Mappings" → "Local files (file://)" with a note that mapping is now
      automatic.
- [x] build + full suite green (410 pass)

## Not done (deliberately)
- Existing bookmarks are NOT migrated — they were stored via manual `canonicalize`
  (raw path if zero-config). Home-swap on restore handles raw absolute paths fine, so
  no migration needed. The `canonicalize`-on-SAVE path (bookmarkManager) is unchanged;
  could later be simplified to store raw absolute + rely on restore home-swap, but left
  alone to avoid churn.
