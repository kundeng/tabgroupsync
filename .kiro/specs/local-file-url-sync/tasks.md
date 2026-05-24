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

## Notes

- Task 3.2 (opener.html) has no dependencies and can be built in parallel with anything
- Machine ID storage uses chrome.storage.local, NOT sync — this is deliberate (Decision 2 in design)
- The URL filter change in task 2.1 is the single most critical change — it's the gate that currently blocks file:// URLs
