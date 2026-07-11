# Design Revision v2: HTTPS Carrier for File URL Sync

**Status:** ACTIVE — supersedes the transport model in `design.md`
**Date:** 2026-07-10
**Reason:** Edge changed its bookmark-sync protocol and no longer transports
`file://` bookmark URLs across machines. The original design stored `file://`
directly in bookmarks and relied on Edge sync to carry them verbatim
(`bookmarkManager.ts:405`). That transport assumption is now false. All path-
mapping logic (`pathMapper.ts`) remains valid and unchanged — only the
**carrier** (what string is physically stored in the synced bookmark) changes.

## The environmental change

| | Old (design.md, verified 2026-05-23) | New (observed 2026-07-10) |
|---|---|---|
| Bookmark stores | `file:///Users/foo/Dropbox/ch1.html` | must store `https://…` |
| Edge sync carries `file://` bookmarks | ✅ yes | ❌ stripped from sync payload |
| Edge sync carries `https://` bookmarks | ✅ yes | ✅ yes (unchanged) |
| Local `file://` bookmarks (not synced) | present | **still present locally** — only the *sync transport* drops them |

> ⚠️ **To confirm on a real machine before implementing:** (1) Are `file://`
> bookmarks dropped from the *sync payload* only, or also deleted from *local*
> bookmark storage? The idle-migration step (below) assumes local `file://`
> bookmarks survive on the machine that wrote them. (2) Does Edge sync preserve
> the `#fragment` of an `https://` bookmark URL verbatim? The carrier depends on
> it. Both are quick to verify via `chrome.bookmarks` + a second signed-in
> machine.

## Carrier format

The bookmark stores an https URL owned (semantically) by the extension, with the
canonical file path in the **fragment**:

```
https://<CARRIER_HOST>/open#<canonical-path>

example:
  file:///Users/foo/Dropbox/book/ch1.html
    →  https://tabgroupsync.github.io/open#/Users/foo/Dropbox/book/ch1.html
```

**CARRIER_HOST** = a real GitHub Pages site we control (decision below). A static,
stateless page. Path lives in the `#fragment`, so:
- Edge syncs it verbatim (it's a plain https bookmark).
- The GitHub server never receives the path (fragments are not sent over the
  network) → no path leakage, no cross-user state, safe to share one page for
  every user.
- The bookmark stays human-readable (the path is visible, not base64).

### Encode / decode (pure string surgery)

The substring after `file://` in a Chrome file URL is already percent-encoded and
fragment-safe (`#` in a name is already `%23`), so:

```typescript
const CARRIER_HOST = 'tabgroupsync.github.io';
const CARRIER_PREFIX = `https://${CARRIER_HOST}/open#`;

// file:///a/b.html  ->  https://HOST/open#/a/b.html
export function encodeCarrier(fileUrl: string): string {
  if (!isFileUrl(fileUrl)) return fileUrl;
  return CARRIER_PREFIX + fileUrl.slice('file://'.length);
}

// https://HOST/open#/a/b.html  ->  file:///a/b.html
export function decodeCarrier(carrierUrl: string): string {
  if (!isCarrierUrl(carrierUrl)) return carrierUrl;
  const hash = carrierUrl.indexOf('#');
  return 'file://' + carrierUrl.slice(hash + 1);
}

export function isCarrierUrl(url: string): boolean {
  return url.startsWith(CARRIER_PREFIX);
}
```

**Bijection:** `decodeCarrier(encodeCarrier(u)) === u` for any file URL `u`.
This becomes Correctness Property 6 (round-trip carrier), tested with fast-check.

## Where it plugs into the existing pipeline

Nothing about path mapping changes. Canonicalization still runs; the carrier wraps
the *canonical* file URL. The pipeline becomes:

```
CAPTURE:   file:// tab  →  canonicalize()  →  encodeCarrier()  →  store bookmark (https)
RESTORE:   bookmark(https) →  decodeCarrier() → localize() → chrome.tabs.create(file://)
CLICK:     bookmark(https) →  webNavigation intercept → decodeCarrier() → localize() → open file://
```

### 1. Capture — `bookmarkManager.ts` (~line 405)

- The dedup set (`existingUrls`) and the re-canonicalize sweep (lines 354–365)
  must **decode carrier bookmarks back to canonical `file://`** before comparison,
  so a tab already backed up as a carrier URL is recognized as a duplicate.
- Store `encodeCarrier(canonicalize(tab.url, cfg))` instead of the bare canonical
  file URL. http/https tabs are unchanged.
- Bookmark title fallback (`extractFilename`) still uses the original `file://`.

### 2. Restore — `background.ts` restore loop

- Before opening: if `isCarrierUrl(url)` → `fileUrl = localize(decodeCarrier(url), cfg)`
  → `chrome.tabs.create({ url: fileUrl })`; on failure fall back to `opener.html`
  (unchanged behavior).
- Keep the existing raw-`file://` branch too, so **legacy bookmarks** written under
  v1 still restore. (`isFileUrl || isCarrierUrl` both route through decode+localize.)

### 3. Click-through — NEW `webNavigation` handler in `background.ts`

Because a synced carrier bookmark is a real https URL, clicking it directly (not via
the extension's Restore UI) would otherwise just load the GitHub info page. We
intercept it:

```typescript
chrome.webNavigation.onBeforeNavigate.addListener(
  async ({ tabId, url, frameId }) => {
    if (frameId !== 0 || !isCarrierUrl(url)) return;      // top frame only
    const cfg = await storage.getPathMappingConfig();
    const fileUrl = localize(decodeCarrier(url), cfg);
    try {
      await chrome.tabs.update(tabId, { url: fileUrl });   // redirect to file://
    } catch {
      await chrome.tabs.update(tabId, { url: openerUrl(fileUrl, url) });
    }
  },
  { url: [{ hostEquals: CARRIER_HOST, pathPrefix: '/open' }] }
);
```

- `onBeforeNavigate.details.url` **includes the fragment** — this is exactly why
  the path lives in the fragment and why `declarativeNetRequest` (which never sees
  fragments) cannot be used here.
- Requires **new manifest entries**: `"webNavigation"` permission and
  `"host_permissions": ["https://<CARRIER_HOST>/*"]`.
- Without the extension (or on a browser where it's not installed), the click
  simply lands on the real GitHub info page — graceful universal fallback.

### 4. Idle migration — NEW alarm (uses existing `alarms` permission)

Existing v1 backups hold bare `file://` bookmarks that Edge now refuses to sync. On
the machine that wrote them (where they still exist locally), an alarm-driven sweep
upgrades them to carrier form so they start syncing again:

```
alarm 'migrate-file-carriers' (every ~6h, idle):
  for each bookmark under the Tab Group Bookmarks container:
    if isFileUrl(bm.url):
      updateBookmark(bm.id, { url: encodeCarrier(canonicalize(bm.url, cfg)) })
```

This is the "rewrite local URLs during idle" idea, made concrete: it runs on the
source machine, is idempotent (carrier URLs are skipped by `isFileUrl`), and needs
no new permissions.

## GitHub Pages fallback page (`/open`)

Static `index.html` on the Pages site. Reads `location.hash` client-side and shows:
the file path, a "this is a local-file bookmark from Tab Group Sync" explainer, and
"install the extension / enable Allow access to file URLs" guidance. It **cannot**
open the file itself (https→file:// is browser-blocked) — that's the extension's job.
Reuses the visual style of `public/opener.html`. Same repo, `docs/` or `gh-pages`.

## Decisions (delta to design.md)

### Decision 5: HTTPS carrier replaces direct `file://` storage
**Context:** Edge sync now strips `file://` bookmark URLs (2026-07-10).
**Options:** (1) `chrome-extension://<ID>/opener?target=…` — but IDs differ per
install *and* it's a non-http scheme likely stripped by the same Edge change;
(2) `https://<host>/open#<path>` carrier — plain https, always synced.
**Decision:** Option 2. **Rationale:** Only http(s) reliably survives the new Edge
sync. https sidesteps both `chrome-extension://` problems. This does **not** revive
the "chrome-extension:// rewriting" rejected in design.md's Out-of-Scope — the tab
stays `file://`; only the *bookmark* is rewritten.

### Decision 6: Path in `#fragment`, not `?query`
**Context:** Encoding the path in a real domain's URL risks leaking local paths to
the host's server logs.
**Decision:** Fragment. **Rationale:** Fragments are never sent over the network, so
the path never reaches GitHub; and `webNavigation` still sees the fragment for
recovery. (Rules out `declarativeNetRequest`, which can't read fragments.)

### Decision 7: Real GitHub Pages host, not a reserved/fake host
**Context:** A `*.invalid` host needs no hosting but dead-ends on extension-less
machines.
**Decision:** Real GitHub Pages site. **Rationale:** Free static hosting, and a
click without the extension lands on a helpful page instead of a DNS error. Shared
statelessly across all users with zero cross-user interaction (path is client-side
in the fragment). Chosen by product owner 2026-07-10.

## New Correctness Property

### Property 6: Carrier round-trip
- **Statement:** *For any* file URL `u`,
  `decodeCarrier(encodeCarrier(u)) === u`, and `encodeCarrier` is a no-op on
  non-file URLs.
- **Validates:** Carrier transport integrity.
- **Test approach:** fast-check over arbitrary (percent-encoded) file URLs.
