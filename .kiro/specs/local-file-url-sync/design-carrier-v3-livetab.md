# Design v3: Live-Tab HTTPS Carrier (Workspace-Safe file:// Sync)

> ⛔ **SUPERSEDED by v4 (`design-carrier-v4-sibling.md`), 2026-07-11.** v3's core
> move — REWRITING a live `file://` tab to a carrier at rest and back on focus —
> is a cross-origin navigation, i.e. a full **page reload**, which destroys the
> in-memory state of stateful local pages. That's inherent, not fixable, so the
> manager was rewritten to the **sibling-tab** model (never touch the live tab;
> create a carrier sibling that syncs). KEEP reading v3 only for the still-valid
> parts it pioneered: the absolute-carrier encoding + decode-time home-swap +
> bootstrap OS-inference (all live in `pathMapper` and carried into v4). Do NOT
> reintroduce the in-place rewrite.

**Status:** SUPERSEDED (was: DRAFT). Superseded v1 (bookmark filter) and v2
(bookmark carrier). 2026-07-11.

## Why v3 exists (corrected premise)

Tonight's live cross-machine test (bayes-pop Pop!/Edge 148 → Windows, same
account) settled the facts that v1/v2 got wrong:

| Claim in v1/v2 | Reality (proven 2026-07-11) |
|---|---|
| "Edge stopped syncing `file://` bookmarks" | **False.** Edge *bookmark* sync carries `file://` fine (48 synced to a clean profile). Earlier failures were broken sync **auth**, not stripping. |
| The problem is bookmark transport | The problem is **Edge Workspaces**: they replace `file://` tabs with "unsupported-workspace"/New Tab on remote machines. |
| Carrier belongs on bookmarks | Carrier belongs on **live tabs** — Edge sweeps even *loose* `file://` tabs into workspaces and mangles them. |

**Proven transport facts (the foundation this design stands on):**
1. A `file://` tab in Edge's sync → **mangled** ("unsupported-workspace") on the remote.
2. An `https://host/open#<path>` tab → **survives intact** on the remote.
3. The URL **`#fragment` survives intact** across workspace sync — so the local path can ride in it.

Therefore: **rewrite live `file://` tabs → `https` carrier so Edge syncs them
safely, and turn them back into `file://` locally.** This is scope **B** —
the only user-transparent fix, because there is no API to stop Edge from
mangling raw `file://`.

## Scope (changed from v1/v2)

- **IN:** every `file://` tab, **grouped OR ungrouped** (user requirement
  2026-07-11 — Edge mangles loose tabs too). The carrier operates at the
  **individual-tab** level; tab groups are orthogonal metadata.
- **IN:** the round-trip: encode on source, survive sync, decode-to-`file://`
  on click/focus on any machine.
- **OUT:** changing how tab *groups* sync (that already works via bookmarks).
- **OUT:** trying to control Edge Workspace membership (no API; we work at the
  tab-URL level, which Edge Workspaces pick up automatically).

## Carrier format (unchanged from v2 — validated)

```
file:///home/kundeng/Dropbox/book/ch1.html
  --canonicalize (path mapping)-->  /Users/kundeng/Dropbox/book/ch1.html
  --encode-->  https://<CARRIER_HOST>/open#/Users/kundeng/Dropbox/book/ch1.html
```
- Path in the **`#fragment`** (proven to survive; never sent to the host server → private).
- `encodeCarrier`/`decodeCarrier` are the same pure bijection from v2.
- `CARRIER_HOST` = the real GitHub-Pages page (extensionless fallback shows the path + guidance).

## The 4 interception points

```
            SOURCE MACHINE                         ANY MACHINE (incl. remote)
  ┌────────────────────────────┐          ┌─────────────────────────────────┐
  │ 1. ENCODE (rewrite at rest) │  Edge    │ 3. DECODE on click/navigate     │
  │    file:// tab → carrier    │  sync    │    carrier → localize → file://  │
  │ 2. HYDRATE on focus         │ ───────► │ 4. FALLBACK opener page          │
  │    carrier → file:// (view) │ (https   │    if no file access/unmapped   │
  └────────────────────────────┘  safe)   └─────────────────────────────────┘
```

### Point 1 — ENCODE (source, at rest), tab-level
- **Hooks:** `chrome.tabs.onUpdated` (URL became `file://`) + an idle
  `chrome.alarms` sweep (`chrome.tabs.query({url:'file://*'})`).
- **Action:** for any `file://` tab **not currently the user's focus**,
  `chrome.tabs.update(tabId,{url: encodeCarrier(canonicalize(url,cfg))})`.
- **Result:** backgrounded `file://` tabs sit as `https` carriers → Edge
  workspace sync carries them safely. Applies grouped or ungrouped.

### Point 2 — HYDRATE (source, on view) — the hard problem
A tab can hold only one URL: `https` (sync-safe) OR `file://` (viewable), not
both. So we swap:
- **On `chrome.tabs.onActivated`** (tab becomes active) AND this machine can
  resolve the path → `chrome.tabs.update(tabId,{url: localize(decodeCarrier(url),cfg)})`
  so the user sees the real file.
- **On deactivate / window blur** (`chrome.tabs.onActivated` of another tab,
  `chrome.windows.onFocusChanged`) → rewrite the just-left carrier back.

**Cost & mitigations (must be decided in review — see Decisions):**
- Each swap **reloads the tab** (scroll/render lost). Minimize by swapping only
  on focus *transitions*, not on every event; debounce.
- The **actively-viewed** tab is briefly `file://`; if Edge snapshots the
  workspace in that window it may mangle *that one tab* — self-heals when
  backgrounded. Only ever affects the single focused tab, never the many at rest.

### Point 3 — DECODE on click/navigate (any machine)
- **Hook:** `chrome.webNavigation.onBeforeNavigate`, filtered
  `{url:[{hostEquals: CARRIER_HOST, pathPrefix:'/open'}]}`, `frameId===0`.
  (`onBeforeNavigate.url` **includes the fragment** — this is why the path lives
  there and why `declarativeNetRequest`, which can't see fragments, is unusable.)
- **Action:** `fileUrl = localize(decodeCarrier(url), cfg)` →
  `chrome.tabs.update(tabId,{url:fileUrl})`. On failure → Point 4.
- **Result:** clicking a synced carrier tab on the remote opens the correct
  local file. This is the "click loads the local URL" half of the round-trip.

### Point 4 — FALLBACK opener page
- If `chrome.tabs.update` to `file://` throws (file access off) or no path
  mapping matches → open `opener.html?target=<file>&original=<carrier>` with the
  path shown + "enable Allow access to file URLs" guidance. Reuses v2's page.

## Path mapping (now per-tab)
Same `pathMapper` (canonicalize/localize, longest-prefix, machine-keyed rules in
`chrome.storage.sync`). **Note the field bug found 2026-07-11:** mappings live under
the sync key `state:pathMappings`, and each machine needs its own rule (the Windows
box had none → restore opened a Mac path). The Settings UI must make "add this
machine" obvious.

## UPDATE 2026-07-11: zero-config home normalization + ABSOLUTE carrier
Manual per-machine rules are now only a FALLBACK. The common case is zero-config:
- **Learn home:** the extension caches this machine's home prefix (`/Users/<u>`,
  `/home/<u>`, `/C:/Users/<u>`) in `storage.local` (`localHome`), learned from any
  `file://` the user opens (`detectHome`/`homeFromFileUrl`).
- **Gate (`shouldCarrier`):** only carrier-ize files under a synced home root
  (default `~/Dropbox`) or a manual rule — never Downloads/system paths.
- **Encode (`fileUrlToCarrier`):** emit the **ABSOLUTE** source path in the carrier
  (`open/#/home/kundeng/Dropbox/…`). A short-lived design put a home-RELATIVE `~`
  in the carrier (`#~/Dropbox/…`); that was REVERTED because any peer that can't
  expand `~` (old build, or home not yet learned) decodes it to the un-openable
  literal `file://~/…` (hit live on a Mac). **Never reintroduce `~`-carriers.**
- **Decode (`carrierToFileUrl`):** swap the detected SOURCE-home prefix for THIS
  machine's `localHome` (cross-OS / cross-user) when home is known; else fall back
  to manual rules / the raw absolute path (always a valid file://). Legacy `~`
  carriers still expand, or return null → opener page — never `file://~/`.
- Verified live both directions on bayes-pop (commit 6e19330). Transport note:
  Edge Workspace sync carries the carrier URL **with its `#fragment` intact**
  (found verbatim in a peer's `Sync Data` LevelDB) — sync is NOT the failure point;
  decode was.

## Permissions (manifest additions)
- `"webNavigation"` — Point 3.
- `"host_permissions": ["https://<CARRIER_HOST>/*"]` — Point 3 filter + intercept.
- Already have: `tabs`, `tabGroups`, `bookmarks`, `storage`, `alarms`.

## New/changed modules
- `pathMapper.ts` — add `encodeCarrier`/`decodeCarrier`/`isCarrierUrl` (from v2).
- `carrierTabManager.ts` (NEW) — owns Points 1 & 2: the at-rest/hydrate state
  machine over `chrome.tabs` events. The one genuinely stateful, tricky module.
- `background.ts` — register the `webNavigation` handler (Point 3) + the idle alarm.
- `Settings.tsx` — per-machine path-mapping UX (incl. "this machine" helper).
- `public/opener.html` — reuse; GitHub-Pages `/open` page (extensionless fallback).

## Decisions (RATIFIED 2026-07-11)
1. **Hydrate model = swap-on-focus.** Backgrounded tabs sit as the carrier;
   focusing a tab swaps it to `file://` for seamless viewing; blur swaps it back.
   Accepted costs: reload-on-focus, and the single focused tab is briefly
   `file://` (self-heals). Chosen for the "user-unaware" goal.
2. **Rewrite scope = only tabs under a mapped path prefix.** A `file://` tab is
   rewritten ONLY if its (canonicalized) path starts with a configured
   path-mapping prefix. Unrelated local files (Downloads, system paths) are never
   touched. `carrierTabManager` must consult `pathMapper` before rewriting.
3. **Carrier host** — real GitHub-Pages page (still to confirm exact URL). Code
   uses a single `CARRIER_HOST` constant so the URL is trivially swappable.

## Correctness properties
- Round-trip: `decodeCarrier(encodeCarrier(u))===u`; `localize(canonicalize(u))===u`.
- Idempotent: encoding a carrier URL is a no-op (`isCarrierUrl` guard) — prevents
  double-encoding on repeated sweeps.
- http(s) tabs never touched.
- No `file://` tab is left as `file://` at rest once a mapping matches (the whole point).

## Test strategy (honest about the boundary)
- **Unit (Vitest):** all pure logic — encode/decode, path mapping, the
  at-rest/hydrate decision function (pass tab state in, assert desired URL out).
  This is where most correctness lives; no browser.
- **CDP integration:** drive a debug-port Edge — open a `file://` tab, assert the
  extension rewrites it to carrier; activate it, assert it hydrates; navigate to a
  carrier URL, assert it opens `file://`.
- **Manual (user):** the one irreducible step — confirm the rewritten carrier tab
  actually survives Edge **Workspace** sync to another machine (cloud round-trip,
  invisible to any automation). Already validated once tonight for the raw URL.
