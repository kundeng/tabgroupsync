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
    await this.encodeInactiveFileTabs(config, activeInfo.tabId);
  };

  /** Browser lost focus → put the active local-file tab back to rest. */
  handleFocusChanged = async (windowId: number): Promise<void> => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) return;
    const config = await this.storage.getPathMappingConfig();
    await this.encodeInactiveFileTabs(config, -1);
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

  /** Idle-alarm sweep (Point 1): force every at-rest local-file tab to carrier. */
  sweepAtRest = async (): Promise<void> => {
    const config = await this.storage.getPathMappingConfig();
    await this.encodeInactiveFileTabs(config, -1);
  };

  private async encodeInactiveFileTabs(
    config: Awaited<ReturnType<StorageManager['getPathMappingConfig']>>,
    exceptTabId: number,
  ): Promise<void> {
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
      if (t.id == null || t.id === exceptTabId || t.active || this.updating.has(t.id)) continue;
      if (t.url && isFileUrl(t.url) && pathHasMapping(t.url, config)) {
        await this.encodeTab(t.id, t.url, config);
      }
    }
  }
}
