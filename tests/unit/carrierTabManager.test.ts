import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CarrierTabManager } from '../../src/lib/carrierTabManager';
import type { PathMappingConfig } from '../../src/lib/types/storage';

const CARRIER = 'https://kundeng.github.io/tabgroupsync/open/#';

// A manual rule so a Mac-origin carrier (/Users/foo) decodes to this Linux box (/home/bar).
const config: PathMappingConfig = {
  machineId: 'linux',
  rules: [{ canonicalPrefix: '/Users/foo/Dropbox', localPrefix: '/home/bar/Dropbox' }],
};

function makeManager(cfg: PathMappingConfig = config) {
  const storage = { getPathMappingConfig: vi.fn().mockResolvedValue(cfg) } as any;
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
  return new CarrierTabManager(storage, logger);
}

let nextTabId = 100;
beforeEach(() => {
  nextTabId = 100;
  const g = globalThis as any;
  g.chrome = g.chrome || {};
  g.chrome.tabs = {
    create: vi.fn().mockImplementation(() => Promise.resolve({ id: nextTabId++ })),
    get: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  };
  g.chrome.extension = { isAllowedFileSchemeAccess: vi.fn().mockResolvedValue(true) };
  g.chrome.runtime = { getURL: (p: string) => `chrome-extension://ID/${p}` };
  g.chrome.storage = {
    local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
  };
  g.chrome.idle = { queryState: vi.fn((_i: number, cb: (s: string) => void) => cb('active')) };
});

describe('reconcile — Rule A: create ONE carrier sibling per local file tab', () => {
  it('creates a background carrier sibling next to a mapped file:// tab', async () => {
    const mgr = makeManager();
    (chrome.tabs.query as any).mockResolvedValue([
      { id: 1, url: 'file:///home/bar/Dropbox/a.html', index: 0, windowId: 5 },
    ]);
    await mgr.reconcile();
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: `${CARRIER}/home/bar/Dropbox/a.html`,
      active: false,
      windowId: 5,
      index: 1,
    });
  });

  it('does NOTHING when the local tab already has a carrier sibling (pair complete)', async () => {
    const mgr = makeManager();
    (chrome.tabs.query as any).mockResolvedValue([
      { id: 1, url: 'file:///home/bar/Dropbox/a.html', index: 0, windowId: 5 },
      { id: 2, url: `${CARRIER}/home/bar/Dropbox/a.html`, index: 1, windowId: 5 },
    ]);
    await mgr.reconcile();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('never touches the live file:// tab (no tabs.update ever)', async () => {
    const mgr = makeManager();
    (chrome.tabs.query as any).mockResolvedValue([
      { id: 1, url: 'file:///home/bar/Dropbox/a.html', index: 0, windowId: 5 },
    ]);
    await mgr.reconcile();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('ignores file tabs not under a synced root', async () => {
    const mgr = makeManager();
    (chrome.tabs.query as any).mockResolvedValue([
      { id: 1, url: 'file:///home/bar/Downloads/x.pdf', index: 0, windowId: 5 },
    ]);
    await mgr.reconcile();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('CROSS-OS: a Mac-origin carrier pairs with a local Linux file → no duplicate carrier', async () => {
    const mgr = makeManager();
    (chrome.tabs.query as any).mockResolvedValue([
      { id: 1, url: 'file:///home/bar/Dropbox/a.html', index: 0, windowId: 5 },        // local (Linux)
      { id: 2, url: `${CARRIER}/Users/foo/Dropbox/a.html`, index: 1, windowId: 5 },    // carrier (Mac origin)
    ]);
    await mgr.reconcile();
    // both normalize to ~/Dropbox/a.html → pair already exists → no new carrier
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});

describe('handleActivated — Rule C: click a synced-in carrier → open a local sibling', () => {
  it('opens the local file as a NEW sibling and keeps the carrier', async () => {
    const mgr = makeManager();
    const carrier = { id: 5, url: `${CARRIER}/Users/foo/Dropbox/a.html`, index: 0, windowId: 9 };
    (chrome.tabs.get as any).mockResolvedValue(carrier);
    (chrome.tabs.query as any).mockResolvedValue([carrier]); // no local sibling yet
    await mgr.handleActivated({ tabId: 5 } as any);
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'file:///home/bar/Dropbox/a.html', // Mac path decoded to this Linux box via rule
      active: true,
      windowId: 9,
      index: 1,
    });
  });

  it('does NOTHING if a local sibling for that file already exists (no recursion)', async () => {
    const mgr = makeManager();
    const carrier = { id: 5, url: `${CARRIER}/Users/foo/Dropbox/a.html`, index: 0, windowId: 9 };
    (chrome.tabs.get as any).mockResolvedValue(carrier);
    (chrome.tabs.query as any).mockResolvedValue([
      carrier,
      { id: 6, url: 'file:///home/bar/Dropbox/a.html', index: 1, windowId: 9 }, // pair complete
    ]);
    await mgr.handleActivated({ tabId: 5 } as any);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('falls back to the opener page when file access is off', async () => {
    const mgr = makeManager();
    const carrier = { id: 5, url: `${CARRIER}/Users/foo/Dropbox/a.html`, index: 0, windowId: 9 };
    (chrome.tabs.get as any).mockResolvedValue(carrier);
    (chrome.tabs.query as any).mockResolvedValue([carrier]);
    (chrome.extension.isAllowedFileSchemeAccess as any).mockResolvedValue(false);
    await mgr.handleActivated({ tabId: 5 } as any);
    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('opener.html'),
      active: true,
    }));
  });

  it('ignores activation of a plain file:// tab (learns home, creates nothing)', async () => {
    const mgr = makeManager();
    (chrome.tabs.get as any).mockResolvedValue({ id: 5, url: 'file:///home/bar/Dropbox/a.html' });
    await mgr.handleActivated({ tabId: 5 } as any);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});

describe('handleUpdated — a file tab loading triggers pairing', () => {
  it('creates a carrier sibling when a file:// tab finishes loading', async () => {
    const mgr = makeManager();
    (chrome.tabs.query as any).mockResolvedValue([
      { id: 1, url: 'file:///home/bar/Dropbox/a.html', index: 0, windowId: 5 },
    ]);
    await mgr.handleUpdated(1, { url: 'file:///home/bar/Dropbox/a.html' } as any, {} as any);
    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({
      url: `${CARRIER}/home/bar/Dropbox/a.html`, active: false,
    }));
  });

  it('ignores non-file url changes', async () => {
    const mgr = makeManager();
    await mgr.handleUpdated(1, { url: 'https://example.com' } as any, {} as any);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});
