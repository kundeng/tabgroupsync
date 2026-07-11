#!/usr/bin/env node
/**
 * probe-file-url-sync.mjs — Empirical test: does the browser's account sync
 * transport `file://` bookmark URLs across machines, or strip them?
 *
 * WHY THIS EXISTS
 * ---------------
 * The `local-file-url-sync` spec assumed Edge sync carries `file://` bookmarks
 * across machines. As of 2026-07 that assumption is in doubt (Edge may now strip
 * non-http(s) schemes server-side). There is NO public doc that settles it, so we
 * test it directly: create a uniquely-named `file://` bookmark on machine A, let
 * it sync, and check whether it arrives on machine B. If it does NOT arrive, the
 * https-carrier redesign (design-carrier-v2.md) is required.
 *
 * WHY IT CAN'T RUN IN A HEADLESS/TTY SESSION
 * ------------------------------------------
 * Browser account sync needs the OS keyring unlocked to decrypt the refresh
 * token. On a bare TTY (no graphical login) the keyring is locked and sync auth
 * fails (`EDGE_IDENTITY … kAccountImageFetchFailure`). Run this from your normal
 * DESKTOP session, where the keyring is unlocked and sync is live.
 *
 * SETUP (once, per machine)
 * -------------------------
 *   1. Fully quit the browser.
 *   2. Relaunch it with a CDP port, using your REAL signed-in profile:
 *        # Edge:
 *        microsoft-edge --remote-debugging-port=9222
 *        # Chrome (install first if needed):
 *        google-chrome --remote-debugging-port=9222
 *   3. Confirm the "Tab Group Sync" extension is installed & enabled (this probe
 *      borrows its `bookmarks` permission). Click the extension icon once to wake
 *      its service worker.
 *   4. Make sure sync is ON for Favorites/Bookmarks and the account is signed in.
 *
 * USAGE
 * -----
 *   # See what file:// bookmarks are currently present (proves what synced here):
 *   node scripts/probe-file-url-sync.mjs --port 9222 --mode inventory
 *
 *   # MACHINE A — create the marker file:// bookmark and record it (to Dropbox):
 *   node scripts/probe-file-url-sync.mjs --port 9222 --mode produce
 *
 *   # ...wait ~30-60s for sync to round-trip through the cloud...
 *
 *   # MACHINE B — check whether the marker arrived via sync:
 *   node scripts/probe-file-url-sync.mjs --port 9222 --mode consume
 *
 *   # Clean up the marker afterwards (run on either machine):
 *   node scripts/probe-file-url-sync.mjs --port 9222 --mode cleanup
 *
 * The marker URL is written to `scripts/.sync-probe-marker.txt`, which — because
 * this repo lives in Dropbox — is itself the cross-machine side channel, so
 * machine B knows exactly which URL to look for.
 *
 * VERDICT
 * -------
 *   consume prints  ✅ ARRIVED  → sync DOES transport file:// (old model still ok)
 *   consume prints  ❌ MISSING  → sync STRIPS file:// (https-carrier redesign needed)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Prefer Node's built-in WebSocket (Node >= 22) so this runs on machines without
// the `ws` npm module (e.g. bayes-f0, where node_modules isn't Dropbox-synced).
// Fall back to the local `ws` module for older Node.
let WebSocket = globalThis.WebSocket;
if (!WebSocket) {
  ({ WebSocket } = await import(new URL('../node_modules/ws/wrapper.mjs', import.meta.url).href));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKER_FILE = join(__dirname, '.sync-probe-marker.txt');

// ---- args --------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, [])
);
const PORT = args.port || '9222';
const MODE = args.mode || 'inventory';
const HOST = args.label || process.env.HOSTNAME || 'unknown-host';

// ---- tiny CDP client ---------------------------------------------------
async function findTargets() {
  const r = await fetch(`http://localhost:${PORT}/json/list`);
  return r.json();
}

const EXT_NAME = args['ext-name'] || 'Tab Group Sync';

/**
 * Find the Tab Group Sync extension context (service worker or bg page) by
 * MANIFEST NAME — the extension ID differs per machine, so we can't hardcode it.
 * Probes each extension target's `chrome.runtime.getManifest().name`.
 */
async function findExtensionWorker() {
  const targets = await findTargets();
  const candidates = targets.filter(
    t => (t.type === 'service_worker' || t.type === 'background_page' || t.type === 'page') &&
         t.url.startsWith('chrome-extension://')
  );
  if (args['ext-id']) {
    const byId = candidates.find(t => t.url.split('/')[2] === args['ext-id']);
    if (byId) return byId;
  }
  for (const t of candidates) {
    try {
      const c = cdp(t.webSocketDebuggerUrl);
      await Promise.race([c.ready, new Promise((_, r) => setTimeout(() => r(new Error('t')), 3000))]);
      await c.send('Runtime.enable');
      const r = await c.send('Runtime.evaluate', {
        expression: `(chrome.runtime.getManifest().name)+'|'+(!!chrome.bookmarks)`,
        returnByValue: true,
      });
      c.close();
      const [name, hasBm] = String(r.result?.result?.value || '').split('|');
      if (name === EXT_NAME && hasBm === 'true') return t;
    } catch { /* skip unreachable targets */ }
  }
  throw new Error(
    `Could not find the "${EXT_NAME}" extension with bookmarks access. Make sure it ` +
    `is installed & enabled and click its popup once to wake the service worker. ` +
    `(Extension targets seen: ${candidates.length})`
  );
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  // Use the WHATWG event API so this works with BOTH the Node built-in WebSocket
  // and the `ws` module (both support addEventListener + event.data).
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', (e) => rej(new Error('ws error: ' + (e.message || 'connect failed'))));
  });
  ws.addEventListener('message', (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString();
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

/** Evaluate an async expression in the extension context, return its value. */
async function evalInExt(conn, asyncBody) {
  const expression = `(async () => { ${asyncBody} })()`;
  const r = await conn.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (r.result && r.result.exceptionDetails) {
    throw new Error('eval error: ' + JSON.stringify(r.result.exceptionDetails));
  }
  if (r.result && r.result.result) return r.result.result.value;
  return r;
}

// chrome.bookmarks helpers, injected as strings into the extension context ----
const JS_WALK_FILE_URLS = `
  const out = [];
  const walk = (nodes) => nodes.forEach(n => {
    if (n.url && n.url.startsWith('file://')) out.push({ id: n.id, title: n.title, url: n.url });
    if (n.children) walk(n.children);
  });
  const tree = await new Promise(r => chrome.bookmarks.getTree(r));
  walk(tree);
  return out;
`;

async function run() {
  const target = await findExtensionWorker();
  console.log(`→ using extension target: ${target.type} ${target.url.split('/').slice(0, 3).join('/')}…`);
  const conn = cdp(target.webSocketDebuggerUrl);
  await conn.ready;
  await conn.send('Runtime.enable');

  if (MODE === 'inventory') {
    const list = await evalInExt(conn, JS_WALK_FILE_URLS);
    console.log(`\nfile:// bookmarks currently in this browser's tree: ${list.length}`);
    list.slice(0, 40).forEach(b => console.log(`  • ${b.url}`));
    if (list.length > 40) console.log(`  … and ${list.length - 40} more`);
  }

  else if (MODE === 'produce') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // file:// marker (the thing under test) + https:// control (known-syncable).
    const fileUrl = `file:///tmp/tabgroup-sync-probe/${stamp}__${HOST}.html`;
    const httpUrl = `https://example.com/tabgroup-sync-probe?stamp=${stamp}&host=${HOST}`;
    const created = await evalInExt(conn, `
      const bar = '1'; // bookmarks bar
      const found = await new Promise(r => chrome.bookmarks.search({ title: 'SyncProbe' }, r));
      let folder = found.find(f => !f.url);
      if (!folder) folder = await new Promise(r => chrome.bookmarks.create({ parentId: bar, title: 'SyncProbe' }, r));
      const fbm = await new Promise(r => chrome.bookmarks.create(
        { parentId: folder.id, title: 'sync-probe FILE ${stamp}', url: ${JSON.stringify(fileUrl)} }, r));
      const hbm = await new Promise(r => chrome.bookmarks.create(
        { parentId: folder.id, title: 'sync-probe HTTP ${stamp}', url: ${JSON.stringify(httpUrl)} }, r));
      return { folderId: folder.id, fileId: fbm.id, fileUrl: fbm.url, httpId: hbm.id, httpUrl: hbm.url };
    `);
    writeFileSync(MARKER_FILE, JSON.stringify({ ...created, host: HOST, stamp }, null, 2));
    console.log(`\n✅ created probe pair on ${HOST}:`);
    console.log(`   FILE  (under test): ${created.fileUrl}`);
    console.log(`   HTTP  (control):    ${created.httpUrl}`);
    console.log(`   recorded to ${MARKER_FILE} (Dropbox side channel)`);
    console.log(`\n   Wait ~30-60s for sync, then run --mode consume on the OTHER machine.`);
  }

  else if (MODE === 'consume') {
    if (!existsSync(MARKER_FILE)) throw new Error(`No marker file at ${MARKER_FILE}. Run --mode produce on machine A first (and let Dropbox sync this repo).`);
    const marker = JSON.parse(readFileSync(MARKER_FILE, 'utf8'));
    const fileUrl = marker.fileUrl || marker.url; // back-compat with single-url markers
    console.log(`\nlooking for probe pair from ${marker.host} @ ${marker.stamp}:`);
    console.log(`   FILE : ${fileUrl}`);
    console.log(`   HTTP : ${marker.httpUrl || '(none)'}`);
    const found = await evalInExt(conn, `
      const all = [];
      const walk = n => n.forEach(x => { if (x.url) all.push(x.url); if (x.children) walk(x.children); });
      walk(await new Promise(r => chrome.bookmarks.getTree(r)));
      return {
        file: all.includes(${JSON.stringify(fileUrl)}),
        http: ${marker.httpUrl ? `all.includes(${JSON.stringify(marker.httpUrl)})` : 'null'},
        totalFile: all.filter(u => u.startsWith('file://')).length,
        total: all.length,
      };
    `);
    const F = found.file ? '✅ ARRIVED' : '❌ MISSING';
    const H = found.http === null ? '—' : (found.http ? '✅ ARRIVED' : '❌ MISSING');
    console.log(`\n   file:// marker : ${F}`);
    console.log(`   https control  : ${H}`);
    console.log(`   (this browser tree: ${found.total} bookmarks, ${found.totalFile} file://)\n`);
    if (found.http === false && found.file === false) {
      console.log(`⚠️  VERDICT: INCONCLUSIVE — neither crossed. Sync is likely paused / not signed in`);
      console.log(`   on one endpoint. Fix sync (edge://settings/profiles/sync) and re-run.`);
    } else if (found.http && !found.file) {
      console.log(`❌ VERDICT: Edge STRIPS file:// from sync (https control crossed, file:// did not).`);
      console.log(`   → https-carrier redesign (design-carrier-v2.md) is REQUIRED.`);
    } else if (found.file) {
      console.log(`✅ VERDICT: file:// STILL syncs across machines — the original model works.`);
      console.log(`   → The carrier redesign is not needed for this browser/version.`);
    } else {
      console.log(`ℹ️  VERDICT: file:// missing; no https control present to disambiguate.`);
    }
  }

  else if (MODE === 'cleanup') {
    if (!existsSync(MARKER_FILE)) { console.log('nothing to clean (no marker file).'); }
    else {
      const marker = JSON.parse(readFileSync(MARKER_FILE, 'utf8'));
      await evalInExt(conn, `
        const list = await new Promise(r => chrome.bookmarks.search({ query: 'sync-probe' }, r));
        for (const b of list) { try { await new Promise(r => chrome.bookmarks.remove(b.id, r)); } catch (e) {} }
        try { const f = await new Promise(r => chrome.bookmarks.search({ title: 'SyncProbe' }, r));
              for (const x of f) if (!x.url) await new Promise(r => chrome.bookmarks.removeTree(x.id, r)); } catch (e) {}
        return true;
      `);
      console.log('🧹 removed probe bookmarks + SyncProbe folder.');
    }
  }

  conn.close();
}

run().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
