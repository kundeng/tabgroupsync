#!/usr/bin/env node
/**
 * carrier-cdp-smoke.mjs — live integration smoke test for the file:// <-> https
 * carrier (design-carrier-v3-livetab), driven over CDP against a real Edge/Chrome
 * that has the built extension loaded.
 *
 * WHY / HOW TO LOAD THE EXTENSION (this is the fiddly part):
 *   Modern Edge (~137+/150) BLOCKS `--load-extension` in HEADLESS mode, but it
 *   still works HEADED when paired with `--disable-extensions-except`. On a
 *   Wayland box you can launch a headed instance from a headless/SSH shell:
 *
 *     export XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-0 \
 *            DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
 *     microsoft-edge --ozone-platform=wayland \
 *       --user-data-dir=/tmp/carrier-test \
 *       --disable-extensions-except=/path/to/dist --load-extension=/path/to/dist \
 *       --remote-debugging-port=9345 --no-first-run about:blank &
 *
 *   (X11 boxes need a valid $DISPLAY + Xauthority. Verified working on Fedora
 *   Wayland with Edge 150; Pop!_OS X11 needs the desktop session's xauth.)
 *
 * USAGE:  node scripts/carrier-cdp-smoke.mjs --port 9345
 * Requires Node >= 22 (built-in WebSocket). Creates a throwaway test file.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1]]);
  return a;
}, []));
const PORT = args.port || '9345';
const CARRIER = 'https://kundeng.github.io/tabgroupsync/open/#';
const TEST_DIR = '/tmp/carrier-test';
const TEST_FILE = `${TEST_DIR}/x.html`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

mkdirSync(TEST_DIR, { recursive: true });
writeFileSync(TEST_FILE, '<!doctype html><title>carrier test</title><h1>local file</h1>');

async function findExtSW() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      // Tab Group Sync opens welcome.html on install — use that page's ext id.
      const wel = list.find(x => x.type === 'page' && /chrome-extension:\/\/[a-p]{32}\/welcome\.html/.test(x.url));
      const extId = wel ? wel.url.split('/')[2] : null;
      const sw = list.find(x => x.type === 'service_worker' && (!extId || x.url.includes(extId)) && x.url.startsWith('chrome-extension://'));
      if (sw && (!extId || sw.url.includes(extId))) return { sw, extId };
      if (extId) { // wake the SW
        const cand = list.find(x => x.type === 'service_worker' && x.url.includes(extId));
        if (cand) return { sw: cand, extId };
      }
    } catch {}
    await sleep(500);
  }
  throw new Error('extension service worker not found — is the build loaded?');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const p = new Map();
  const ready = new Promise((res, rej) => { ws.addEventListener('open', () => res()); ws.addEventListener('error', () => rej(new Error('ws'))); });
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
  return { ready, send: (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }) };
}

const { sw } = await findExtSW();
const c = cdp(sw.webSocketDebuggerUrl);
await c.ready;
await c.send('Runtime.enable');

// ENCODE: an inactive mapped file:// tab -> carrier.
const enc = await c.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `
  new Promise(async resolve => { try {
    await chrome.storage.local.set({ machineId: 'test' });
    await chrome.storage.sync.set({ 'state:pathMappings': { machines: { test: { machineId:'test', rules:[{ canonicalPrefix:'${TEST_DIR}', localPrefix:'${TEST_DIR}' }] } } } });
    const f = await chrome.tabs.create({ url: 'file://${TEST_FILE}', active: true });
    await new Promise(r=>setTimeout(r,600));
    await chrome.tabs.create({ url: 'about:blank', active: true });
    await new Promise(r=>setTimeout(r,3000));
    resolve((await chrome.tabs.get(f.id)).url);
  } catch(e){ resolve('ERR:'+e) } })` });
const encUrl = enc.result?.result?.value || '';
console.log(`ENCODE: ${encUrl.startsWith(CARRIER) ? '✅' : '❌'} ${encUrl.slice(0, 80)}`);

// DECODE: navigate to a carrier -> file:// (or opener if no file access).
const carrier = `${CARRIER}${TEST_FILE}`;
const newTab = await (await fetch(`http://localhost:${PORT}/json/new?${encodeURI(carrier).replace('#', '%23')}`, { method: 'PUT' })).json();
await sleep(3500);
const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
const decUrl = (list.find(x => x.id === newTab.id)?.url) || '';
const decOk = decUrl.startsWith('file://') || decUrl.includes('opener.html');
console.log(`DECODE: ${decOk ? '✅' : '❌'} ${decUrl.slice(0, 80)}`);

process.exit(encUrl.startsWith(CARRIER) && decOk ? 0 : 1);
