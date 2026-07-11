import type { StorageManager } from './storage/storageManager';
import type { Logger } from './utils/logger';
import {
  isFileUrl,
  isCarrierUrl,
  encodeCarrier,
  decodeCarrier,
  canonicalize,
  localize,
  pathHasMapping,
  CARRIER_HOST,
} from './utils/pathMapper';

/**
 * CarrierTabManager (design-carrier-v3-livetab) — keeps local-file tabs safe
 * from Edge Workspace sync, which mangles every non-http(s) URL into
 * "workspace-unsupported" on remote machines.
 *
 * Strategy (RATIFIED): a `file://` tab whose path is under a configured
 * path-mapping prefix is held as an **https carrier** while AT REST (so Edge
 * syncs it as an ordinary web tab), and HYDRATED back to `file://` when the user
 * ACTIVATES it (so they see the real file). On a remote machine, activating or
 * navigating to a carrier tab decodes it to the machine-local `file://` path.
 *
 * Loop-safety: our own `chrome.tabs.update` calls are tracked in `updating` and
 * ignored by the update listener; and the carrier-decode intercept only fires
 * for the ACTIVE tab, so an at-rest carrier we just wrote is left alone.
 */
export class CarrierTabManager {
  private storage: StorageManager;
  private logger: Logger;
  private updating = new Set<number>();

  static readonly CARRIER_HOST = CARRIER_HOST;

  constructor(storage: StorageManager, logger: Logger) {
    this.storage = storage;
    this.logger = logger;
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
      // release the guard shortly after; onUpdated for our change fires first
      setTimeout(() => this.updating.delete(tabId), 1500);
    }
  }

  /** Rewrite an at-rest local-file tab to its https carrier (canonical path). */
  private async encodeTab(tabId: number, fileUrl: string, config: Awaited<ReturnType<StorageManager['getPathMappingConfig']>>): Promise<void> {
    const carrier = encodeCarrier(canonicalize(fileUrl, config));
    if (carrier === fileUrl) return;
    await this.update(tabId, carrier);
    this.logger.debug('carrier:encoded', { tabId });
  }

  /** Hydrate a carrier tab back to the machine-local file:// (or opener page). */
  private async hydrateTab(tabId: number, carrierUrl: string, config: Awaited<ReturnType<StorageManager['getPathMappingConfig']>>): Promise<void> {
    const fileUrl = localize(decodeCarrier(carrierUrl), config);
    const allowed = await this.hasFileAccess();
    if (allowed) {
      await this.update(tabId, fileUrl);
      this.logger.debug('carrier:hydrated', { tabId });
    } else {
      const opener =
        chrome.runtime.getURL('opener.html') +
        '?target=' + encodeURIComponent(fileUrl) +
        '&original=' + encodeURIComponent(carrierUrl);
      await this.update(tabId, opener);
      this.logger.debug('carrier:hydrate-fallback-opener', { tabId });
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
    if (!url || !isFileUrl(url) || tab.active) return;
    const config = await this.storage.getPathMappingConfig();
    if (pathHasMapping(url, config)) await this.encodeTab(tabId, url, config);
  };

  /** Tab activated → hydrate it if carrier; encode any now-inactive file tabs. */
  handleActivated = async (activeInfo: chrome.tabs.TabActiveInfo): Promise<void> => {
    const config = await this.storage.getPathMappingConfig();
    let active: chrome.tabs.Tab | undefined;
    try {
      active = await chrome.tabs.get(activeInfo.tabId);
    } catch {
      return;
    }
    if (active?.url && isCarrierUrl(active.url) && !this.updating.has(activeInfo.tabId)) {
      await this.hydrateTab(activeInfo.tabId, active.url, config);
    }
    // put any other local-file tabs back to rest (carrier)
    await this.encodeFileTabs(config, { exceptTabId: activeInfo.tabId });
  };

  /** Browser lost focus → put the active local-file tab back to rest. */
  handleFocusChanged = async (windowId: number): Promise<void> => {
    const config = await this.storage.getPathMappingConfig();
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      // Browser lost focus: nothing is being viewed -> ALL mapped file tabs to
      // carrier (including the active one, which is no longer on screen).
      await this.encodeFileTabs(config, { includeActive: true });
      return;
    }
    // Browser gained focus on `windowId`: hydrate its active tab if it's a carrier.
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
    const config = await this.storage.getPathMappingConfig();
    await this.hydrateTab(details.tabId, details.url, config);
  };

  /**
   * Idle-alarm sweep (Point 1): force every AT-REST local-file tab to carrier.
   * "At rest" = everything except the tab the user is actually viewing (the
   * active tab of the currently-focused window).
   */
  sweepAtRest = async (): Promise<void> => {
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

  /**
   * Encode mapped local-file tabs to their carriers. By default skips ACTIVE
   * tabs (being viewed); pass includeActive to also encode active ones (e.g. on
   * browser blur). `exceptTabId` protects the one tab the user is viewing.
   */
  private async encodeFileTabs(
    config: Awaited<ReturnType<StorageManager['getPathMappingConfig']>>,
    opts: { includeActive?: boolean; exceptTabId?: number } = {},
  ): Promise<void> {
    const { includeActive = false, exceptTabId } = opts;
    // Query all tabs and filter in JS: the file:// match pattern is finicky
    // ('file:///*' vs 'file://*'), and querying by pattern would silently
    // return nothing on a malformed pattern. isFileUrl is the source of truth.
    let tabs: chrome.tabs.Tab[] = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return;
    }
    for (const t of tabs) {
      if (t.id == null || t.id === exceptTabId || this.updating.has(t.id)) continue;
      if (!includeActive && t.active) continue;
      if (t.url && isFileUrl(t.url) && pathHasMapping(t.url, config)) {
        await this.encodeTab(t.id, t.url, config);
      }
    }
  }
}
