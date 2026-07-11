import type { StorageManager } from './storage/storageManager';
import type { Logger } from './utils/logger';
import {
  isFileUrl,
  isCarrierUrl,
  fileUrlToCarrier,
  carrierToFileUrl,
  shouldCarrier,
  homeFromFileUrl,
  CARRIER_HOST,
  type LocalOs,
} from './utils/pathMapper';

/** This machine's OS family from the SW's navigator — for bootstrap home inference. */
function detectOs(): LocalOs | null {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'win';
  if (/Linux|X11|CrOS/.test(ua)) return 'linux';
  return null;
}

type Cfg = Awaited<ReturnType<StorageManager['getPathMappingConfig']>>;

/**
 * CarrierTabManager (design-carrier-v3-livetab) — keeps local-file tabs safe
 * from Edge Workspace sync, which mangles every non-http(s) URL into
 * "workspace-unsupported" on remote machines.
 *
 * A `file://` tab under a synced home root (default `~/Dropbox`, zero-config) or
 * a manual mapping rule is held as an **https carrier** while AT REST (so Edge
 * syncs it as an ordinary web tab), and HYDRATED back to `file://` when the user
 * ACTIVATES it. Carriers are stored HOME-RELATIVE (`~/Dropbox/...`), so each
 * machine strips/prepends its own auto-detected home — no per-machine rules for
 * the common case. `localHome` is LEARNED from the file:// URLs the user opens
 * and cached in storage.local.
 *
 * Loop-safety: our own `chrome.tabs.update` calls are tracked in `updating` and
 * ignored by the update listener; the carrier-decode intercept only fires for
 * the ACTIVE tab, so an at-rest carrier we just wrote is left alone.
 */
export class CarrierTabManager {
  private storage: StorageManager;
  private logger: Logger;
  private updating = new Set<number>();
  private localHome: string | null = null;
  private homeLoaded = false;
  private readonly localOs: LocalOs | null = detectOs();

  static readonly CARRIER_HOST = CARRIER_HOST;

  constructor(storage: StorageManager, logger: Logger) {
    this.storage = storage;
    this.logger = logger;
  }

  // --- home learning ------------------------------------------------------

  /** Load the cached home once (from storage.local) before handling events. */
  private async ensureHome(): Promise<void> {
    if (this.homeLoaded) return;
    try {
      const d = await chrome.storage.local.get('localHome');
      if (typeof d.localHome === 'string') this.localHome = d.localHome;
    } catch { /* ignore */ }
    this.homeLoaded = true;
  }

  /** Learn this machine's home prefix from any file:// URL the user opens. */
  private async learnHome(fileUrl: string): Promise<void> {
    const h = homeFromFileUrl(fileUrl);
    if (h && h !== this.localHome) {
      this.localHome = h;
      try { await chrome.storage.local.set({ localHome: h }); } catch { /* ignore */ }
      this.logger.debug('carrier:learned-home', { home: h });
    }
  }

  // --- internal helpers ---------------------------------------------------

  private async update(tabId: number, url: string): Promise<boolean> {
    this.updating.add(tabId);
    try {
      await chrome.tabs.update(tabId, { url });
      return true;
    } catch (e) {
      this.logger.debug('carrier:update-failed', { tabId, url: url.slice(0, 60), error: String(e) });
      return false;
    } finally {
      setTimeout(() => this.updating.delete(tabId), 1500);
    }
  }

  /** Rewrite an at-rest local-file tab to its https carrier (home-relative). */
  private async encodeTab(tabId: number, fileUrl: string, config: Cfg): Promise<void> {
    const carrier = fileUrlToCarrier(fileUrl, this.localHome, config);
    if (carrier === fileUrl) return;
    await this.update(tabId, carrier);
    this.logger.debug('carrier:encoded', { tabId });
  }

  /** Hydrate a carrier tab back to the machine-local file:// (or opener page). */
  private async hydrateTab(tabId: number, carrierUrl: string, config: Cfg): Promise<void> {
    const fileUrl = carrierToFileUrl(carrierUrl, this.localHome, config, this.localOs);
    const canOpen = fileUrl !== null && await this.hasFileAccess();
    if (canOpen) {
      await this.update(tabId, fileUrl as string);
      this.logger.debug('carrier:hydrated', { tabId });
    } else {
      // fileUrl===null => home not learned yet (bootstrap); show the path we have.
      const shown = fileUrl ?? carrierUrl;
      const opener =
        chrome.runtime.getURL('opener.html') +
        '?target=' + encodeURIComponent(shown) +
        '&original=' + encodeURIComponent(carrierUrl);
      await this.update(tabId, opener);
      this.logger.debug('carrier:hydrate-fallback-opener', { tabId, reason: fileUrl === null ? 'no-home' : 'no-file-access' });
    }
  }

  private async hasFileAccess(): Promise<boolean> {
    try {
      return await chrome.extension.isAllowedFileSchemeAccess();
    } catch {
      return false;
    }
  }

  // --- event handlers (registered top-level in background.ts) --------------

  /** file:// tab opened/navigated in the background → encode to carrier. */
  handleUpdated = async (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): Promise<void> => {
    if (this.updating.has(tabId)) return;
    const url = changeInfo.url;
    if (!url || !isFileUrl(url)) return;
    await this.ensureHome();
    await this.learnHome(url);              // learn home from any file the user opens
    if (tab.active) return;                 // active tabs stay file:// for viewing
    const config = await this.storage.getPathMappingConfig();
    if (shouldCarrier(url, this.localHome, config)) await this.encodeTab(tabId, url, config);
  };

  /** Tab activated → hydrate it if carrier; encode any now-inactive file tabs. */
  handleActivated = async (activeInfo: chrome.tabs.TabActiveInfo): Promise<void> => {
    await this.ensureHome();
    const config = await this.storage.getPathMappingConfig();
    let active: chrome.tabs.Tab | undefined;
    try {
      active = await chrome.tabs.get(activeInfo.tabId);
    } catch {
      return;
    }
    if (active?.url && isFileUrl(active.url)) await this.learnHome(active.url);
    if (active?.url && isCarrierUrl(active.url) && !this.updating.has(activeInfo.tabId)) {
      await this.hydrateTab(activeInfo.tabId, active.url, config);
    }
    await this.encodeFileTabs(config, { exceptTabId: activeInfo.tabId });
  };

  /** Browser lost focus → put all file tabs to rest; focus gained → hydrate active. */
  handleFocusChanged = async (windowId: number): Promise<void> => {
    await this.ensureHome();
    const config = await this.storage.getPathMappingConfig();
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      await this.encodeFileTabs(config, { includeActive: true });
      return;
    }
    let active: chrome.tabs.Tab[] = [];
    try {
      active = await chrome.tabs.query({ active: true, windowId });
    } catch {
      return;
    }
    const t = active[0];
    if (t?.id != null && t.url && isCarrierUrl(t.url) && !this.updating.has(t.id)) {
      await this.hydrateTab(t.id, t.url, config);
    }
  };

  /** Navigation to a carrier URL: decode ONLY for the active tab (at-rest stays). */
  handleBeforeNavigate = async (details: chrome.webNavigation.WebNavigationParentedCallbackDetails): Promise<void> => {
    if (details.frameId !== 0 || !isCarrierUrl(details.url) || this.updating.has(details.tabId)) return;
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.get(details.tabId);
    } catch {
      return;
    }
    if (!tab?.active) return; // background carriers stay carriers (sync-safe)
    await this.ensureHome();
    const config = await this.storage.getPathMappingConfig();
    await this.hydrateTab(details.tabId, details.url, config);
  };

  /**
   * Idle-alarm sweep: force every AT-REST local-file tab to carrier. "At rest" =
   * everything except the tab the user is actually viewing (active tab of the
   * currently-focused window).
   */
  sweepAtRest = async (): Promise<void> => {
    await this.ensureHome();
    const config = await this.storage.getPathMappingConfig();
    let viewedTabId: number | undefined;
    try {
      const win = await chrome.windows.getLastFocused();
      if (win?.focused && win.id != null) {
        const [t] = await chrome.tabs.query({ active: true, windowId: win.id });
        viewedTabId = t?.id;
      }
    } catch { /* no focused window -> nothing is being viewed */ }
    await this.encodeFileTabs(config, { includeActive: true, exceptTabId: viewedTabId });
  };

  private async encodeFileTabs(
    config: Cfg,
    opts: { includeActive?: boolean; exceptTabId?: number } = {},
  ): Promise<void> {
    const { includeActive = false, exceptTabId } = opts;
    let tabs: chrome.tabs.Tab[] = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return;
    }
    for (const t of tabs) {
      if (t.id == null || t.id === exceptTabId || this.updating.has(t.id)) continue;
      if (!includeActive && t.active) continue;
      if (t.url && isFileUrl(t.url) && shouldCarrier(t.url, this.localHome, config)) {
        await this.encodeTab(t.id, t.url, config);
      }
    }
  }
}
