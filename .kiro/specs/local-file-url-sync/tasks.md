# Tasks: Local File URL Sync

## Status marks
<!-- [ ] pending | [x] done | [~] skipped | [!] BLOCKED: reason | [ ]* optional -->

## Tasks

- [x] 1. Foundation
  - [x] 1.1 Add PathMapping types to storage.ts
    - Add `PathMappingRule`, `PathMappingConfig`, `PathMappingStore` interfaces
    - Add `pathMappings?` and `currentMachineId?` to `GlobalSettings`
    - **Depends**: —
    - **Requirements**: 2.2, 2.3
    - **Properties**: 5

  - [x] 1.2 Create pathMapper.ts utility module
    - Implement `isFileUrl()`, `isSyncableUrl()`, `extractFilename()`
    - Implement `canonicalize(fileUrl, config)` — local→canonical prefix rewrite
    - Implement `localize(fileUrl, config)` — canonical→local prefix rewrite
    - Implement `areSameFile(url1, url2, config)` — canonicalize both, compare
    - Handle edge cases: trailing slashes, URL-encoded chars, Windows drive letters, fragments
    - Longest-prefix match when multiple rules apply
    - **Depends**: 1.1
    - **Requirements**: 1.2, 1.3, 1.4, 2.6, 3.1, 3.2
    - **Properties**: 1, 2, 4, 5

  - [x] 1.3 Add StorageManager methods for path mapping
    - `getPathMappingConfig()` — returns config for current machine
    - `setPathMappingConfig(config)` — saves config for current machine
    - `getAllMachineConfigs()` — returns all machines' configs
    - `getCurrentMachineId()` / `setCurrentMachineId(id)` — uses chrome.storage.local
    - **Depends**: 1.1
    - **Requirements**: 2.3, 2.4

- [x] 2. Core — Capture
  - [x] 2.1 Modify URL filter in bookmarkManager.ts
    - Replace http/https-only check at line 369 with `isSyncableUrl()`
    - Add `file://` to allowed schemes, keep filtering chrome:// edge:// about:// brave://
    - Load path mapping config before filter loop
    - Canonicalize file:// URLs before dedup check and before bookmark creation
    - Build `existingUrls` set from canonicalized URLs
    - Use `extractFilename()` as fallback bookmark title for file:// URLs without titles
    - **Depends**: 1.2, 1.3
    - **Requirements**: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7

- [x] 3. Core — Restore
  - [x] 3.1 Modify restore handler in background.ts
    - Load path mapping config before restore loop
    - Apply `localize()` to file:// bookmark URLs before `chrome.tabs.create()`
    - Wrap file:// `chrome.tabs.create()` in try/catch — fallback to opener page on failure
    - Ensure http(s) URLs are unaffected — no path mapping applied
    - Ensure file:// failures don't abort remaining URLs
    - **Depends**: 1.2, 1.3
    - **Requirements**: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

  - [x] 3.2 Create opener.html fallback page
    - Plain HTML/CSS/JS page in `public/`
    - Display target file path, original canonical path, mapping info
    - "Try opening" button using `window.location.href`
    - Instructions for enabling "Allow access to file URLs"
    - Link to `chrome://extensions/?id=` + extension ID
    - Dark mode support via `prefers-color-scheme`
    - Match welcome.html visual style (CSS variables, layout)
    - **Depends**: —
    - **Requirements**: 4.1, 4.2, 4.3, 4.4, 4.5

- [x] 4. UI
  - [x] 4.1 Add Path Mappings section to Settings.tsx
    - Collapsible "Path Mappings (file:// sync)" section
    - Machine ID text input (persisted to chrome.storage.local)
    - Mapping rule list: canonical prefix + local prefix, editable inline
    - Add/remove mapping buttons
    - Save on change via StorageManager
    - **Depends**: 1.3
    - **Requirements**: 2.1, 2.2, 2.4, 2.7

  - [x] 4.2 Add Edge Workspace warning to Settings
    - Detect Edge via `navigator.userAgent.includes('Edg/')`
    - Show MUI Alert (warning severity) below path mappings section
    - Explain: workspace unsupported tabs, close-kills-source behavior
    - Only visible when browser is Edge AND path mappings are configured
    - **Depends**: 4.1
    - **Requirements**: 7.1, 7.2, 7.3, 7.4

  - [x] 4.3 Add file:// permission detection banner
    - Use `chrome.extension.isAllowedFileSchemeAccess()` to detect
    - Show informational banner in Settings when file:// access not enabled
    - Provide link to extension settings page
    - **Depends**: 4.1
    - **Requirements**: 5.1, 5.2, 5.3, 5.4

- [x] 5. Tests
  - [x] 5.1 Unit tests for pathMapper.ts
    - canonicalize: with mapping, without mapping, longest-prefix match
    - localize: with mapping, without mapping, no matching rule
    - areSameFile: same file different machines, different files
    - isFileUrl / isSyncableUrl: file, http, https, chrome, edge, about
    - extractFilename: normal path, URL-encoded, no extension, deep path
    - Edge cases: Windows paths, trailing slashes, fragments, query strings
    - **Depends**: 1.2
    - **Properties**: 1, 2, 4, 5

  - [x] 5.2 Property tests for pathMapper.ts
    - Round-trip: `localize(canonicalize(url, c), c) === url`
    - Idempotency: `canonicalize(canonicalize(url, c), c) === canonicalize(url, c)`
    - http(s) passthrough: `canonicalize(httpUrl, anyConfig) === httpUrl`
    - No-mapping passthrough: `canonicalize(url, emptyConfig) === url`
    - **Depends**: 1.2
    - **Properties**: 1, 2, 4, 5

  - [x] 5.3 Unit tests for capture flow (bookmarkManager)
    - file:// URL is included (not filtered)
    - file:// URL is canonicalized before bookmark creation
    - Dedup works across canonical forms (no flip-flop duplicates)
    - chrome:// edge:// still filtered
    - Mixed http + file group syncs correctly
    - No mapping config — file:// stored as-is
    - **Depends**: 2.1
    - **Properties**: 3, 4

  - [~] 5.4 Unit tests for restore flow (background.ts)
    - file:// bookmark localized before tab creation
    - Fallback to opener page on create failure
    - http(s) URLs unaffected
    - Mixed group restores all URLs
    - No mapping config — file:// opened as-is
    - **Depends**: 3.1

  - [ ]* 5.5 E2E test for file:// capture and restore
    - Full flow: create tab group with file:// tab, sync, restore on same machine
    - Requires test file on disk and "Allow access to file URLs"
    - **Depends**: 2.1, 3.1, 3.2

- [~] 6. Revision v2 — HTTPS Carrier on BOOKMARKS (SUPERSEDED by v3, see below)
  <!-- v2 premise (Edge stopped syncing file:// bookmarks) was DISPROVEN
       2026-07-11: bookmark sync carries file:// fine. Real problem = Edge
       Workspaces mangle file:// TABS. Superseded by group 7 (design-carrier-v3). -->
- [ ] 6. Revision v2 — HTTPS Carrier (transport fix, see design-carrier-v2.md)
  - [ ] 6.0 Verify Edge's new behavior on two synced machines FIRST
    - Confirm `file://` bookmarks are dropped from the sync payload (and whether
      they also vanish from LOCAL bookmark storage — migration 6.5 depends on
      local survival)
    - Confirm Edge preserves the `#fragment` of an `https://` bookmark verbatim
      across sync
    - **Depends**: — | **Gates**: all of task 6

  - [ ] 6.1 Add carrier functions to pathMapper.ts
    - `encodeCarrier(fileUrl)`, `decodeCarrier(carrierUrl)`, `isCarrierUrl(url)`
    - `CARRIER_HOST` constant = the GitHub Pages host
    - **Depends**: 6.0 | **Requirements**: 8.1, 8.2, 8.7 | **Properties**: 6

  - [ ] 6.2 Capture: wrap canonical file URLs in carrier form
    - `bookmarkManager.ts` ~line 405: store `encodeCarrier(canonicalize(url))`
    - Decode carrier bookmarks back to canonical `file://` when building the
      `existingUrls` dedup set AND in the re-canonicalize sweep (lines 354–365)
    - **Depends**: 6.1 | **Requirements**: 8.1, 8.8

  - [ ] 6.3 Restore: decode carrier before opening
    - `background.ts` restore loop: route `isCarrierUrl` through
      `localize(decodeCarrier(url))`; keep the bare-`file://` branch for v1 backups
    - **Depends**: 6.1 | **Requirements**: 8.3, 8.8

  - [ ] 6.4 Click-through: webNavigation intercept
    - `onBeforeNavigate` filtered to `hostEquals: CARRIER_HOST, pathPrefix:/open`
    - Decode + localize + `chrome.tabs.update` to file://; opener.html on failure
    - Manifest: add `"webNavigation"` + `host_permissions: ["https://HOST/*"]`
    - **Depends**: 6.1 | **Requirements**: 8.4

  - [ ] 6.5 Idle migration alarm
    - Alarm `migrate-file-carriers` (~6h): re-encode bare `file://` bookmarks under
      the container to carrier form; idempotent
    - **Depends**: 6.1 | **Requirements**: 8.6

  - [ ] 6.6 Static carrier page on GitHub Pages
    - `/open` reads `location.hash`, shows path + setup guidance; no file open
    - Reuse `public/opener.html` styling; publish via `docs/` or `gh-pages`
    - **Depends**: — | **Requirements**: 8.5

  - [ ] 6.7 Tests
    - Property: carrier round-trip `decodeCarrier(encodeCarrier(u)) === u` (Prop 6)
    - Unit: capture stores carrier; restore accepts carrier AND bare file://;
      migration is idempotent; dedup matches carrier vs raw file:// tab
    - **Depends**: 6.1–6.5 | **Properties**: 6

- [ ] 7. Revision v3 — LIVE-TAB HTTPS Carrier (workspace-safe, see design-carrier-v3-livetab.md)
  - [x] 7.0 Prove the transport (live cross-machine test)
    - file:// tab → mangled ("unsupported-workspace"); https carrier tab → survives;
      #fragment survives. All confirmed 2026-07-11 (bayes-pop → Windows).
  - [x] 7.1 Carrier + scope functions in pathMapper.ts
    - `encodeCarrier`/`decodeCarrier`/`isCarrierUrl`/`CARRIER_HOST` + `pathHasMapping`
      (mapped-prefix scope guard). Unit-tested (36 tests incl. bijection + scope).
  - [x] 7.2 carrierTabManager.ts — at-rest/hydrate state machine
    - Point 1 ENCODE (onUpdated + sweep), Point 2 HYDRATE (onActivated/focus swap,
      ratified swap-on-focus), Point 3 DECODE (handleBeforeNavigate, active-only),
      Point 4 opener fallback. Loop-safe via `updating` guard.
  - [x] 7.3 Wire into background.ts + manifest
    - Top-level listeners (onUpdated/onActivated/onFocusChanged/webNavigation),
      periodic sweep on the sync alarm. Manifest: `webNavigation` +
      `host_permissions` for CARRIER_HOST. Typechecks + builds clean.
  - [x] 7.2b Unit tests for carrierTabManager state machine
    - 9 tests: encode-at-rest (inactive/active/mapped/unmapped), decode-on-click
      (active hydrate / background stays / opener fallback / subframe ignore),
      handleActivated (hydrate active + encode others + skip unmapped). All green.
  - [~] 7.4 CARRIER_HOST `/open` fallback page — ARTIFACT created
    (`public/carrier-open.html`, parchment theme, reads location.hash). REMAINING:
    publish it at `https://<CARRIER_HOST>/open` and set `CARRIER_HOST` to the real URL.
  - [ ] 7.5 Settings UI: per-machine path mapping + "this machine" helper
    - Make adding THIS machine's rule obvious (the missing-Windows-rule bug).
  - [ ]* 7.6 CDP integration test (blocked: Edge 148 refuses CLI unpacked-ext load;
    needs edge://extensions "Load unpacked" — a manual step). Logic is unit-covered.
  - [ ] 7.7 MANUAL round-trip test (user, headed signed-in Edge) — see Notes.

## Notes

- Task 3.2 (opener.html) has no dependencies and can be built in parallel with anything
- **Group 7 (v3) is the live one; group 6 (v2 bookmark carrier) is superseded** —
  the premise that Edge stopped syncing file:// bookmarks was disproven.
- **MANUAL round-trip test (7.7)** — do this in your real signed-in Edge:
  1. `edge://extensions` → Developer mode → Load unpacked → `dist/`.
  2. Enable **"Allow access to file URLs"** for it.
  3. Settings → add a path mapping for THIS machine (e.g. `/Users/you/Dropbox`
     ↔ this machine's Dropbox path); set a Machine ID.
  4. Open a `file://` under that prefix; switch to another tab → confirm the file
     tab's URL becomes `https://tabgroupsync.github.io/open#…` (carrier at rest).
  5. On a second signed-in machine, open the synced workspace → the carrier tab
     survives; click it → the extension opens the local file (or opener page).
- **Revision v2**: Task 6.0 is a hard gate — do not implement the carrier until the
  new Edge behavior is confirmed on real synced machines. The carrier is a pure
  wrapper around the existing (still-valid) path-mapping layer.
- Machine ID storage uses chrome.storage.local, NOT sync — this is deliberate (Decision 2 in design)
- The URL filter change in task 2.1 is the single most critical change — it's the gate that currently blocks file:// URLs
