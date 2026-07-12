# Carrier v4 — Sibling-tab model (supersedes v3's live-tab rewrite)

Status: **in progress** (2026-07-11). Builds on v3 (`design-carrier-v3-livetab.md`)
and the absolute-carrier + home-swap decode from that doc's 2026-07-11 update.

## Why v4 exists — v3's fatal flaw for stateful pages

v3 makes a *live* `file://` tab **sync-safe** by REWRITING its URL to an https
carrier at rest and back to `file://` on focus. But rewriting a tab's URL across
origins (`file://` ⇄ `https://`) is a **cross-origin navigation → full page
reload**. `history.replaceState` can't cross origins, so there is no way to change
the URL without reloading. Consequences the user hit live:
- A stateful local page (e.g. an HTML app that loads a CSV into an in-memory CRUD
  model) **loses all in-memory state every time it loses focus** and gets encoded.
- `file://` and the carrier are **different origins** → `localStorage`/`IndexedDB`
  don't carry across the swap either (only the URL's own `?query#hash` survives).
- Decode-on-return is **inconsistent** (MV3 service worker sleeps → sometimes the
  tab stays on the github page until a manual refresh).

This is not a bug we can fix — it's inherent to rewriting a live tab. And per-page
opt-out filtering "won't fly" because this is a general-purpose extension, not a
personal hack. So the model must change.

## What DID work in v3 (keep it)
- Absolute carrier encoding + **decode-time home-swap** (`/Users/<u>` ⇄ `/home/<u>`
  ⇄ `/C:/Users/<u>`, cross-username) + bootstrap OS-inference. Keep all of
  `pathMapper` (`fileUrlToCarrier`, `carrierToFileUrl`, `inferLocalHome`, new `pairKey`).
- Live-verified: Edge sync carries the carrier URL **with its `#fragment` intact**;
  and when the encode fires before Edge snapshots, **no `file://` leaks** (0 hits in
  the peer's Sync Data). So the carrier transport itself is sound.

## v4 model — a PAIR of tabs, never rewrite the live one

For each local file path `P` the user opens, maintain a pair:
- **local tab** — the real `file://P` tab. NEVER touched → keeps all state.
- **carrier tab** — a sibling `https://…/open/#<abs P>` tab. This is what syncs.

Pairing is by **`pairKey(url, localHome)`** (in `pathMapper`): normalizes both a
`file://` URL and a carrier URL to the same home-relative key (`~/Dropbox/x`), so a
local tab and its carrier match **across machines and OSes**.

### Rules
- **A (create):** a local tab for `P` exists and **no** carrier tab for `P` exists in
  this browser → create the carrier as a **background sibling** (never navigate the
  local tab). Guard on `pairKey` incl. synced-in carriers → never a duplicate.
- **C (hydrate on click):** user activates a carrier tab for `P` and **no** local tab
  for `P` exists here → open `file://P` as a **new sibling** (foreground) and **keep
  the carrier** (so the carrier stays the single, stable, synced identity).
- **Reconcile:** on `tabs.onUpdated` (file loaded), `onActivated`, idle, and the
  periodic sweep — re-assert the invariant (each local has one carrier; dedupe by key).
- **Removal (v1, simple):** when a local tab closes and no other local for its key
  remains, close the carrier sibling we created for it.

### Why the carrier is NEVER navigated away
If clicking a carrier navigated *it* to `file://`, Rule A would then see a local with
no carrier and mint a **second** carrier — which syncs back → duplicate carriers
proliferate. Keeping the carrier immortal (one per key, synced everywhere) and opening
local files as separate siblings is what stops that. This is the "check the pair, do
nothing" guard the user asked for, made precise.

### Recursion guard (worked example)
Source opens `file://P` → Rule A mints carrier `C` → `C` syncs to dest. Dest clicks
`C` → Rule C opens `file://P'` sibling, keeps `C`. Dest now has {C, local} → Rule A
sees `C` exists → no new carrier → nothing syncs back → **no loop**.

## Known, ACCEPTED costs of v4 (call them out honestly)
- The live `file://` tab still **syncs as a `workspace-unsupported` tab** on peers
  (Edge syncs every open tab; we can't suppress it, and we **must not auto-close it** —
  closing an unsupported tab on a peer can cascade and close the real live tab on the
  source). So unsupported "litter" returns; it can be closed by hand but not safely by us.
- **Tabs roughly double** (local + carrier per file, + a peer's unsupported).
- No true hidden tab exists — the carrier must be a real (background/pinned) tab, or
  Edge won't sync it. Offscreen docs / separate windows aren't in the workspace → don't sync.
- We can't distinguish stateful vs stateless pages, so v4 applies to all. (v3 was
  cleaner for *stateless* pages; v4 is the price of never breaking *stateful* ones.)

## Test bed (so this is testable solo)
`scripts/edge-sync-testbed.sh` on bayes-pop: a 2nd signed-in, CDP-drivable Edge (9223)
that syncs with the real one (9222) as a separate device. Lets us drive source+dest of
a round-trip on one box. (Edge 150 blocks default-profile remote-debugging; Edge 148
allows it — that's why the bed runs on bayes-pop, not f0.) See memory
`edge-sync-testbed-selfserve`.

## Implementation checklist
- [x] `pairKey()` in pathMapper (cross-OS pairing key)
- [x] Rewrite `CarrierTabManager` to sibling mode: `reconcile()`, `createCarrier()`,
      `openLocalSibling()`; dropped in-place encode/hydrate.
- [x] Loop guards: `busy` (tabs we create) + `creating`/`opening` (keys mid-op).
- [x] Unit tests for reconcile/pairing/dedupe/recursion (11 tests).
- [x] Live on the test bed (9223): file tab stays `file://` (state preserved),
      exactly one carrier sibling, reconcile again = no duplicate. ✅
- [x] Rule C verified LIVE on the bed (9223): activating a synced-in carrier with
      no local sibling opened a `file://` sibling AND kept the carrier. ✅
- [~] Cross-device carrier sync on the bed (9223→9222) did **not** propagate this
      run (0 hits in 9222's Sync Data after 90s). Likely cause: the bed's two
      instances share only the *account*, not an open **Workspace** — and plain
      "open tabs" (sessions) sync between a same-machine copy-device and the
      default doesn't propagate like Workspace sync does. Edge Workspaces can't be
      opened via CDP, so the bed can't reproduce the Workspace-sync leg. That leg
      was already proven separately on real devices (bayes-pop → bayes-f0: carrier
      with `#fragment` intact in the peer's Sync Data). **Bed is great for driving
      both ends' LOGIC; the Workspace-sync propagation still needs a real shared
      Workspace to observe.**
- [ ] FOLLOW-UP: orphan-carrier removal (safe heuristic to distinguish an orphan
      from a synced-in-not-yet-opened carrier). Deferred; carriers persist for now.
