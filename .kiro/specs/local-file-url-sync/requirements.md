---
spec_id: local-file-url-sync
status: ACTIVE
since: 2026-05-23
until: null
epic: sync
features: [file-url-capture, path-mapping, file-url-restore, opener-page]
supersedes: []
superseded_by: null
depends_on: []
---

# Requirements: Local File URL Sync

## Introduction

> **Revision v2 (2026-07-10):** Edge changed its bookmark-sync protocol and no
> longer transports `file://` bookmark URLs across machines — the transport this
> spec originally relied on. `file://` URLs are now wrapped in an **https carrier**
> (`https://<host>/open#<path>`) so they survive sync, and decoded back to
> `file://` on restore/click. See `design-carrier-v2.md` and **Requirement 8**.
> All path-mapping requirements (1–3) still hold; only the stored carrier changes.

Tab Group Sync currently filters out all non-http(s) URLs at sync time
(`bookmarkManager.ts:369`), which means `file://` tabs — common among
users who read local documentation, Dropbox-synced books, or offline
references — are silently dropped from backups. Edge's bookmark sync
already transports `file://` URLs across machines (verified 2026-05-23),
so the transport layer is not the problem.

This spec adds `file://` URL support to the existing backup/restore
model. It does NOT convert the extension into a live sync engine. The
extension remains event-driven: capture tab groups → bookmark folders on
the source machine; user-initiated restore on the target machine.

The core challenge is that file paths differ across machines
(`/Users/foo/Dropbox/` on macOS vs `/home/foo/Dropbox/` on Linux vs
`C:\Users\foo\Dropbox\` on Windows). A path-mapping system lets users
define prefix rewrite rules per machine so that restoring a tab group
on a different OS opens the correct local path.

A second challenge is the **flip-flop problem**: when Machine B restores
a file:// bookmark and its sync engine later fires, the locally-mapped
path differs from the original path in the bookmark. Without
canonicalization, the sync engine would create a duplicate bookmark for
each machine that restores the group — compounding on every
restore-then-sync cycle. Path mappings must therefore be **bidirectional**:
applied in reverse at capture time (local→canonical) and forward at
restore time (canonical→local), so bookmarks always contain the same
canonical path regardless of which machine wrote them.

A third concern is the interaction with **Edge Workspaces**: Edge's
workspace sync shows `file://` tabs as "workspace unsupported" on remote
machines, but closing these phantom tabs actually closes the real tab on
the source machine — destroying the user's local state. This is Edge
behavior outside the extension's control, but users must be warned.

## Glossary

- **File_URL**: A `file://` protocol URL pointing to a local filesystem
  path (e.g., `file:///home/user/Dropbox/book/ch1.html`)
- **Path_Mapping**: A user-defined bidirectional rule pairing a
  Canonical_Prefix with a Local_Prefix. Applied forward (canonical→local)
  at restore time and in reverse (local→canonical) at capture time.
- **Canonical_Prefix**: The path prefix stored in bookmarks as the
  stable reference form (e.g., `/Users/foo/Dropbox`). Typically the
  path on the machine that first synced the group, but user-configurable.
- **Local_Prefix**: This machine's equivalent path for a Canonical_Prefix
  (e.g., `/home/bar/Dropbox` on Linux for the same Dropbox folder)
- **Opener_Page**: An extension-controlled HTML page that handles
  `file://` navigation when direct opening fails or when the user needs
  to configure mappings
- **Source_Machine**: The machine where tab groups are captured to
  bookmark folders
- **Target_Machine**: The machine where bookmark folders are restored to
  tab groups
- **Machine_ID**: A user-assigned label for the current machine (e.g.,
  "macbook-work", "linux-home") used to select which path mappings apply

## Requirements

### Requirement 1: File URL Capture (with Canonicalization)

**User Story:** As a user with local documentation tabs (Dropbox books,
offline references), I want my `file://` tabs included when I sync a tab
group, so that my local reading state is preserved alongside web tabs —
and without creating duplicate bookmarks when multiple machines sync the
same group.

#### Acceptance Criteria

1. WHEN a tab group contains `file://` URLs, THE Sync_Engine SHALL
   include them in the bookmark folder alongside http/https URLs
2. WHEN a `file://` URL is captured AND a path mapping exists where
   the URL's path starts with the Local_Prefix, THE Sync_Engine SHALL
   reverse-map the path to the Canonical_Prefix before writing the
   bookmark (e.g., local `/home/bar/Dropbox/book/ch1.html` →
   canonical `/Users/foo/Dropbox/book/ch1.html`)
3. WHEN a `file://` URL is captured AND no path mapping matches, THE
   Sync_Engine SHALL store the original `file://` URL as-is
4. WHEN comparing a `file://` tab URL against existing bookmarks for
   deduplication, THE Sync_Engine SHALL canonicalize both sides before
   comparison — preventing duplicates from path variants of the same
   logical file
5. WHEN a tab group contains a mix of `file://` and `http(s)://` URLs,
   THE Sync_Engine SHALL sync all of them without treating `file://`
   URLs differently in ordering or grouping
6. WHEN a `file://` URL has no page title, THE Sync_Engine SHALL use
   the filename from the path as the bookmark title
7. WHEN browser-internal URLs (`chrome://`, `edge://`, `about:`, `brave://`)
   are present, THE Sync_Engine SHALL continue to filter them out — only
   `file://` is newly allowed

### Requirement 2: Path Mapping Configuration

**User Story:** As a user who works on multiple machines with different
OS and filesystem layouts, I want to define bidirectional path prefix
mappings so that my local file bookmarks are stored canonically and
open correctly on each machine.

#### Acceptance Criteria

1. WHEN a user opens the Settings panel, THE Extension SHALL display a
   "Path Mappings" section where bidirectional prefix rules can be
   added, edited, and removed
2. WHEN a user adds a mapping, THE Extension SHALL accept a
   "Canonical prefix" (the path form stored in bookmarks, typically the
   path on the machine that first synced) and a "This machine's prefix"
   (the equivalent local path), e.g., canonical: `/Users/foo/Dropbox`,
   this machine: `/home/bar/Dropbox`
3. WHEN path mappings are saved, THE Storage_Manager SHALL persist them
   in `chrome.storage.sync` so they are available on all machines, keyed
   by Machine_ID
4. WHEN a user has multiple machines, THE Extension SHALL allow the user
   to assign a Machine_ID label for the current machine. Each machine
   sees only its own Local_Prefix but all Canonical_Prefixes are shared
5. WHEN no path mappings are configured, THE Extension SHALL still
   capture `file://` URLs and restore them using the original path
   (no rewriting, no canonicalization)
6. WHEN a `file://` path matches multiple mapping rules, THE Extension
   SHALL apply the longest-prefix match
7. WHEN the user is on the machine whose paths ARE the canonical form
   (i.e., Canonical_Prefix equals Local_Prefix), THE Extension SHALL
   store URLs as-is — no rewriting needed

### Requirement 3: File URL Restore

**User Story:** As a user restoring a tab group on a different machine,
I want `file://` bookmarks to open using the correct local path for
this machine, so that I can continue reading where I left off.

#### Acceptance Criteria

1. WHEN a tab group is restored and it contains `file://` bookmarks, THE
   Sync_Engine SHALL apply the current machine's path mappings before
   opening the tabs
2. WHEN a `file://` URL has a matching path mapping, THE Extension SHALL
   rewrite the prefix and open the mapped URL via `chrome.tabs.create()`
3. WHEN a `file://` URL has no matching path mapping, THE Extension SHALL
   attempt to open the original URL as-is
4. WHEN `chrome.tabs.create()` fails for a `file://` URL (e.g., "Allow
   access to file URLs" is not enabled), THE Extension SHALL open the
   Opener_Page instead, showing the target path and instructions
5. WHEN restoring a group with mixed `file://` and `http(s)://` URLs, THE
   Extension SHALL open all URLs — `file://` URLs should not block or
   delay `http(s)://` URL restoration
6. WHEN a `file://` tab is restored on the same machine that captured it,
   THE Extension SHALL open the original URL without any path rewriting

### Requirement 4: Opener Page

**User Story:** As a user on a machine where `file://` access is not
configured or the file doesn't exist at the expected path, I want a
helpful fallback page instead of a broken tab, so that I can fix the
issue and still access my file.

#### Acceptance Criteria

1. WHEN a `file://` URL cannot be opened directly, THE Extension SHALL
   display an Opener_Page with the target file path prominently shown
2. WHEN the Opener_Page is displayed, IT SHALL show: (a) the original
   source path, (b) the mapped path (if mapping was applied), (c) a
   "Try opening" button that attempts `window.location.href = file://...`,
   and (d) instructions for enabling "Allow access to file URLs"
3. WHEN the user has configured path mappings, THE Opener_Page SHALL
   show what mapping was applied and allow the user to try a different
   path manually
4. WHEN multiple `file://` tabs fail to open, THE Extension SHALL open
   one Opener_Page per tab (not a single aggregated page)
5. WHEN the Opener_Page is used, IT SHALL match the visual style of the
   existing welcome.html page (CSS variables, dark mode support, layout
   patterns)

### Requirement 5: Permissions and Setup

**User Story:** As a user enabling file URL sync for the first time, I
want clear guidance on what browser settings are needed, so that the
feature works without trial and error.

#### Acceptance Criteria

1. WHEN `file://` URLs are detected in a tab group for the first time,
   THE Extension SHALL show an informational banner explaining that
   "Allow access to file URLs" must be enabled in extension settings
2. WHEN the extension does not have file URL access, THE Extension SHALL
   detect this (by attempting to access a `file://` URL) and show a
   warning in the Settings panel
3. WHEN path mappings are configured, THE Extension SHALL NOT require
   any new manifest permissions — path mapping is pure string rewriting
   at restore time
4. WHEN a user clicks "Allow access to file URLs" guidance, THE Extension
   SHALL provide the direct URL to the extension's settings page
   (`chrome://extensions/?id=EXTENSION_ID`)

### Requirement 6: Scope Boundaries

**User Story:** As an existing user, I want file URL sync to work within
the extension's current backup/restore model without changing how the
extension fundamentally works.

#### Acceptance Criteria

1. THE Extension SHALL NOT become a live sync engine — bookmark changes
   on remote machines SHALL NOT automatically create or update tab groups
2. THE Extension SHALL NOT sync ungrouped tabs — `file://` or otherwise.
   Only tabs within named Chrome tab groups are in scope
3. THE Extension SHALL NOT rewrite `file://` URLs to `chrome-extension://`
   at capture time — bookmarks remain human-readable `file://` URLs.
   Canonicalization (Req 1.2) rewrites path prefixes but preserves the
   `file://` scheme
4. THE Extension SHALL NOT require a centralized server or account — path
   mappings sync via Chrome's existing `chrome.storage.sync`
5. WHEN the file URL sync feature has no configuration, THE Extension
   SHALL behave exactly as it does today for `http(s)://` URLs — zero
   behavior change for users who don't use `file://` tabs

### Requirement 7: Edge Workspace Interaction Warning

**User Story:** As a user who has both Edge Workspaces and this extension
active, I want to be warned about the dangerous interaction where closing
a "workspace unsupported" tab on the remote machine kills the real tab
on the source machine.

#### Acceptance Criteria

1. WHEN the extension detects that the browser is Edge (via
   `navigator.userAgent` or `chrome.runtime`), THE Extension SHALL
   display a warning in the Settings panel about Edge Workspace
   interaction with `file://` tabs
2. THE warning SHALL explain: (a) Edge Workspaces shows `file://` tabs
   as "workspace unsupported" on remote machines, (b) closing these
   phantom tabs CLOSES the real tab on the source machine, (c) this is
   Edge behavior outside the extension's control
3. THE warning SHALL recommend: if using this extension for `file://`
   sync, consider removing `file://` tab groups from Edge Workspaces
   to avoid accidental tab closure on the source machine
4. THE Extension SHALL NOT attempt to interfere with Edge Workspace
   behavior — this is an informational warning only

### Requirement 8: HTTPS Carrier Encoding (Revision v2)

**User Story:** As a user whose `file://` tabs must survive Edge's new sync
protocol, I want the extension to store my local-file bookmarks as https URLs
that Edge will sync, and transparently recover the `file://` path on any machine.

#### Acceptance Criteria

1. WHEN a `file://` URL is captured, THE Sync_Engine SHALL store it in the
   bookmark as an https carrier URL of the form `https://<CARRIER_HOST>/open#<path>`,
   where `<path>` is the canonical file path (Req 1.2 canonicalization applied first)
2. THE carrier SHALL place the file path in the URL **fragment** (`#…`), never in
   the query string, so the path is never transmitted to the carrier host's server
3. WHEN a bookmark holds a carrier URL, THE Extension SHALL decode it back to a
   `file://` URL (then apply `localize`, Req 3) before opening on restore
4. WHEN a user directly clicks a carrier bookmark (outside the Restore flow), THE
   Extension SHALL intercept the navigation (`webNavigation`), decode + localize the
   URL, and open the `file://` tab — falling back to the Opener_Page on failure
5. WHEN the extension is not installed on a machine, a clicked carrier bookmark
   SHALL land on the static carrier page, which displays the file path and setup
   guidance (it SHALL NOT attempt to open the file — browsers block https→file://)
6. WHEN legacy bookmarks written under Revision v1 hold bare `file://` URLs, THE
   Extension SHALL, on an idle alarm, re-encode them to carrier form on the machine
   that holds them locally — idempotently (carrier URLs are left unchanged)
7. THE carrier encode/decode SHALL be a lossless bijection:
   `decodeCarrier(encodeCarrier(u)) === u` for any `file://` URL `u`
8. WHEN restoring, THE Extension SHALL accept BOTH carrier URLs and bare `file://`
   URLs (backward compatibility with v1 backups)

### Non-Functional

**NF 1: Backward Compatibility**

1. WHEN the extension is updated, existing bookmark folders SHALL remain
   unchanged — no migration of existing bookmarks is required
2. WHEN path mappings are not configured, THE Extension SHALL capture
   and restore `file://` URLs using original paths (graceful degradation)

**NF 2: Storage Efficiency**

1. Path mapping configuration SHALL fit within `chrome.storage.sync`
   quota limits (approximately 100KB total)
2. Path mappings SHALL be stored efficiently — a typical user has 2-5
   machines with 1-3 mapping rules each

## Out of Scope

- **Live bidirectional sync**: The extension does not watch bookmark
  changes to update live tab groups. This spec does not change that.
- **Ungrouped tabs**: `file://` or otherwise, ungrouped tabs remain
  excluded from sync per existing Requirement 12.
- **Non-file custom protocols**: `ftp://`, `ssh://`, custom protocol
  handlers are not included in this spec.
- **File content caching**: The extension does not cache or transfer
  file contents — only URLs (paths) are synced.
- **Automatic path detection**: The extension does not auto-detect the
  equivalent path on the target machine. Users configure mappings
  manually.
- **chrome-extension:// URL rewriting**: `file://` URLs are NOT
  converted to `chrome-extension://` at capture time. This was
  considered and rejected because: (a) extension IDs differ per
  installation, (b) it would make bookmarks unreadable to humans,
  (c) the source machine user has the file open — replacing their
  tab URL with a wrapper would be confusing. Path canonicalization
  (Req 1.2) rewrites prefixes but preserves the `file://` scheme.
- **Edge Workspace management**: The extension does not control Edge
  Workspace tab sync behavior. It warns about the dangerous
  interaction (Req 7) but does not mitigate it programmatically.
