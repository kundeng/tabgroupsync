import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CarrierTabManager } from '../../src/lib/carrierTabManager';
import type { PathMappingConfig } from '../../src/lib/types/storage';

const CARRIER = 'https://tabgroupsync.github.io/open#';

const config: PathMappingConfig = {
  machineId: 'linux',
  rules: [{ canonicalPrefix: '/Users/foo/Dropbox', localPrefix: '/home/bar/Dropbox' }],
};

function makeManager(cfg: PathMappingConfig = config) {
  const storage = { getPathMappingConfig: vi.fn().mockResolvedValue(cfg) } as any;
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
  return new CarrierTabManager(storage, logger);
}

beforeEach(() => {
  const g = globalThis as any;
  g.chrome = g.chrome || {};
  g.chrome.tabs = {
    update: vi.fn().mockResolvedValue({}),
    get: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 1 }),
  };
  g.chrome.extension = { isAllowedFileSchemeAccess: vi.fn().mockResolvedValue(true) };
  g.chrome.windows = { WINDOW_ID_NONE: -1 };
  g.chrome.runtime = { getURL: (p: string) => `chrome-extension://ID/${p}` };
});

describe('CarrierTabManager.handleUpdated (encode at rest)', () => {
  it('rewrites an INACTIVE mapped file:// tab to the canonical carrier', async () => {
    const mgr = makeManager();
    await mgr.handleUpdated(1, { url: 'file:///home/bar/Dropbox/book/ch1.html' } as any, { active: false } as any);
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, {
      url: `${CARRIER}/Users/foo/Dropbox/book/ch1.html`, // localPrefix -> canonicalPrefix
    });
  });

  it('leaves an ACTIVE file:// tab as-is (user is viewing it)', async () => {
    const mgr = makeManager();
    await mgr.handleUpdated(1, { url: 'file:///home/bar/Dropbox/book/ch1.html' } as any, { active: true } as any);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('ignores file:// tabs NOT under a mapped prefix', async () => {
    const mgr = makeManager();
    await mgr.handleUpdated(1, { url: 'file:///home/bar/Downloads/x.pdf' } as any, { active: false } as any);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('ignores non-file URLs', async () => {
    const mgr = makeManager();
    await mgr.handleUpdated(1, { url: 'https://example.com' } as any, { active: false } as any);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});

describe('CarrierTabManager.handleBeforeNavigate (decode on click)', () => {
  it('hydrates an ACTIVE carrier tab to the machine-local file:// path', async () => {
    const mgr = makeManager();
    (chrome.tabs.get as any).mockResolvedValue({ active: true });
    await mgr.handleBeforeNavigate({
      frameId: 0, tabId: 5, url: `${CARRIER}/Users/foo/Dropbox/book/ch1.html`,
    } as any);
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, {
      url: 'file:///home/bar/Dropbox/book/ch1.html', // canonical -> localPrefix
    });
  });

  it('leaves a BACKGROUND carrier tab as a carrier (sync-safe at rest)', async () => {
    const mgr = makeManager();
    (chrome.tabs.get as any).mockResolvedValue({ active: false });
    await mgr.handleBeforeNavigate({
      frameId: 0, tabId: 5, url: `${CARRIER}/Users/foo/Dropbox/book/ch1.html`,
    } as any);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('falls back to the opener page when file access is disabled', async () => {
    const mgr = makeManager();
    (chrome.tabs.get as any).mockResolvedValue({ active: true });
    (chrome.extension.isAllowedFileSchemeAccess as any).mockResolvedValue(false);
    await mgr.handleBeforeNavigate({
      frameId: 0, tabId: 5, url: `${CARRIER}/Users/foo/Dropbox/book/ch1.html`,
    } as any);
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, {
      url: expect.stringContaining('opener.html'),
    });
  });

  it('ignores sub-frame navigations and non-carrier URLs', async () => {
    const mgr = makeManager();
    (chrome.tabs.get as any).mockResolvedValue({ active: true });
    await mgr.handleBeforeNavigate({ frameId: 1, tabId: 5, url: `${CARRIER}/x` } as any);
    await mgr.handleBeforeNavigate({ frameId: 0, tabId: 5, url: 'https://example.com' } as any);
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});

describe('CarrierTabManager.handleActivated (hydrate focus + encode the rest)', () => {
  it('hydrates the newly-active carrier tab AND re-encodes other inactive file tabs', async () => {
    const mgr = makeManager();
    (chrome.tabs.get as any).mockResolvedValue({ active: true, url: `${CARRIER}/Users/foo/Dropbox/a.html` });
    (chrome.tabs.query as any).mockResolvedValue([
      { id: 9, active: false, url: 'file:///home/bar/Dropbox/b.html' },
      { id: 5, active: true, url: `${CARRIER}/Users/foo/Dropbox/a.html` }, // the active one — must be skipped
      { id: 7, active: false, url: 'file:///home/bar/Downloads/skip.pdf' }, // unmapped — skip
    ]);
    await mgr.handleActivated({ tabId: 5 } as any);
    // hydrated the active carrier tab 5 to local file://
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, { url: 'file:///home/bar/Dropbox/a.html' });
    // encoded the other inactive mapped file tab 9
    expect(chrome.tabs.update).toHaveBeenCalledWith(9, { url: `${CARRIER}/Users/foo/Dropbox/b.html` });
    // did NOT touch the unmapped file tab 7
    expect(chrome.tabs.update).not.toHaveBeenCalledWith(7, expect.anything());
  });
});
