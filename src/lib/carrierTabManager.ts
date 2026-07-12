import type { StorageManager } from './storage/storageManager';
import type { Logger } from './utils/logger';
import {
  isFileUrl,
  isCarrierUrl,
  fileUrlToCarrier,
  carrierToFileUrl,
  shouldCarrier,
  homeFromFileUrl,
  pairKey,
  osFromUserAgent,
  CARRIER_HOST,
  type LocalOs,
} from './utils/pathMapper';

type Cfg = Awaited<ReturnType<StorageManager['getPathMappingConfig']>>;

/** This machine's OS family from the SW's navigator — for bootstrap home inference. */
function detectOs(): LocalOs | null {
  return osFromUserAgent((typeof navigator !== 'undefined' && navigator.userAgent) || '');
}

/**
 * CarrierTabManager (design-carrier-v4-sibling) — makes local-file tabs survive
 * Edge Workspace sync WITHOUT ever rewriting the live tab (which would reload it
 * and destroy in-memory page state).
 *
 * Model: for each local file path the user opens, maintain a PAIR of tabs —
 *   • local tab   = the real `file://` tab, NEVER touched → keeps all state.
 *   • carrier tab = a sibling `https://…/open/#<abs-path>` tab that syncs.
 * Pairing is by `pairKey` (home-relative, cross-OS). Rules:
 *   A) a local tab with no carrier sibling → create the carrier (background).
 *   C) activating a synced-in carrier with no local sibling → open the local
 *      file as a NEW sibling and KEEP the carrier (so the carrier stays the one
 *      stable synced identity → no duplicate carriers, no sync recursion).
 * The carrier is never navigated away, so "check the pair, do nothing" holds.
 *
 * NOT handled in v1: auto-removal of orphaned carriers (a carrier with no local
 * sibling is ambiguous — orphan vs. synced-in-not-yet-opened — so we never
 * auto-close carriers; the user closes them). See the design doc.
 */
export class CarrierTabManager {
  private storage: StorageManager;
  private logger: Logger;
  private localHome: string | null = null;
  private homeLoaded = false;
  private readonly localOs: LocalOs | null = detectOs();
  private busy = new Set<number>();      // tabs we created/opened — ignore their events
  private creating = new Set<string>();  // pairKeys mid carrier-create — dedupe
  private opening = new Set<string>();   // pairKeys mid local-sibling-open — dedupe

  static readonly CARRIER_HOST = CARRIER_HOST;

  constructor(storage: StorageManager, logger: Logger) {
    this.storage = storage;
    this.logger = logger;
  }

  // --- home learning ------------------------------------------------------

  private async ensureHome(): Promise<void> {
    if (this.homeLoaded) return;
    try {
      const d = await chrome.storage.local.get('localHome');
      if (typeof d.localHome === 'string') this.localHome = d.localHome;
    } catch { /* ignore */ }
    this.homeLoaded = true;
  }

  private async learnHome(fileUrl: string): Promise<void> {
    const h = homeFromFileUrl(fileUrl);
    if (h && h !== this.localHome) {
      this.localHome = h;
      try { await chrome.storage.local.set({ localHome: h }); } catch { /* ignore */ }
      this.logger.debug('carrier:learned-home', { home: h });
    }
  }

  private key(url: string): string | null {
    return pairKey(url, this.localHome);
  }

  private async hasFileAccess(): Promise<boolean> {
    try {
      return await chrome.extension.isAllowedFileSchemeAccess();
    } catch {
      return false;
    }
  }

  private track(tabId: number | undefined): void {
    if (tabId == null) return;
    this.busy.add(tabId);
    setTimeout(() => this.busy.delete(tabId), 3000);
  }

  // --- core: keep each local file tab paired with one carrier sibling -----

  /** Ensure every synced-root file:// tab has exactly one carrier sibling. */
  reconcile = async (): Promise<void> => {
    await this.ensureHome();
    const config = await this.storage.getPathMappingConfig();
    let tabs: chrome.tabs.Tab[] = [];
    try { tabs = await chrome.tabs.query({}); } catch { return; }

    const carrierKeys = new Set<string>();
    const locals: { tab: chrome.tabs.Tab; key: string }[] = [];
    for (const t of tabs) {
      if (!t.url || t.id == null) continue;
      if (isCarrierUrl(t.url)) {
        const k = this.key(t.url);
        if (k) carrierKeys.add(k);
      } else if (isFileUrl(t.url) && shouldCarrier(t.url, this.localHome, config)) {
        const k = this.key(t.url);
        if (k) locals.push({ tab: t, key: k });
      }
    }
    for (const { tab, key } of locals) {
      if (carrierKeys.has(key) || this.creating.has(key)) continue;
      await this.createCarrier(tab, config);
      carrierKeys.add(key); // don't double-create for the same key in one pass
    }
  };

  /** Rule A: create a background carrier sibling next to a local file tab. */
  private async createCarrier(localTab: chrome.tabs.Tab, config: Cfg): Promise<void> {
    const carrier = fileUrlToCarrier(localTab.url as string, this.localHome, config);
    if (carrier === localTab.url) return; // not carrier-izable
    const key = this.key(localTab.url as string);
    if (key == null) return;
    this.creating.add(key);
    try {
      const t = await chrome.tabs.create({
        url: carrier,
        active: false,
        windowId: localTab.windowId,
        index: (localTab.index ?? 0) + 1,
      });
      this.track(t.id);
      this.logger.debug('carrier:sibling-created', { key });
    } catch (e) {
      this.logger.debug('carrier:sibling-failed', { error: String(e) });
    } finally {
      setTimeout(() => this.creating.delete(key), 3000);
    }
  }

  /** Rule C: activating a synced-in carrier with no local sibling → open the
   *  local file as a NEW sibling (keep the carrier). */
  private async openLocalSibling(carrierTab: chrome.tabs.Tab, config: Cfg): Promise<void> {
    const key = this.key(carrierTab.url as string);
    if (key == null || this.opening.has(key)) return;
    let tabs: chrome.tabs.Tab[] = [];
    try { tabs = await chrome.tabs.query({}); } catch { return; }
    const hasLocal = tabs.some(t => t.url && isFileUrl(t.url) && this.key(t.url) === key);
    if (hasLocal) return; // pair already complete → do nothing (no recursion)

    const fileUrl = carrierToFileUrl(carrierTab.url as string, this.localHome, config, this.localOs);
    const canOpen = fileUrl !== null && await this.hasFileAccess();
    const url = canOpen
      ? (fileUrl as string)
      : chrome.runtime.getURL('opener.html')
        + '?target=' + encodeURIComponent(fileUrl ?? (carrierTab.url as string))
        + '&original=' + encodeURIComponent(carrierTab.url as string);

    this.opening.add(key);
    try {
      const t = await chrome.tabs.create({
        url,
        active: true,
        windowId: carrierTab.windowId,
        index: (carrierTab.index ?? 0) + 1,
      });
      this.track(t.id);
      this.logger.debug('carrier:local-sibling-opened', { key, viaOpener: !canOpen });
    } catch (e) {
      this.logger.debug('carrier:local-sibling-failed', { error: String(e) });
    } finally {
      setTimeout(() => this.opening.delete(key), 3000);
    }
  }

  // --- event handlers (registered top-level in background.ts) --------------

  /** A file:// tab loaded → learn home + ensure it has a carrier sibling. */
  handleUpdated = async (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, _tab: chrome.tabs.Tab): Promise<void> => {
    if (this.busy.has(tabId)) return;
    const url = changeInfo.url;
    if (!url || !isFileUrl(url)) return;
    await this.ensureHome();
    await this.learnHome(url);
    await this.reconcile();
  };

  /** Carrier tab activated (user clicked it) → open its local sibling. */
  handleActivated = async (activeInfo: chrome.tabs.TabActiveInfo): Promise<void> => {
    if (this.busy.has(activeInfo.tabId)) return;
    await this.ensureHome();
    let tab: chrome.tabs.Tab | undefined;
    try { tab = await chrome.tabs.get(activeInfo.tabId); } catch { return; }
    if (tab?.url && isFileUrl(tab.url)) { await this.learnHome(tab.url); return; }
    if (tab?.url && isCarrierUrl(tab.url)) {
      const config = await this.storage.getPathMappingConfig();
      await this.openLocalSibling(tab, config);
    }
  };

  /** Carrier tab navigated while active (click a link / reload it) → open local sibling. */
  handleBeforeNavigate = async (details: chrome.webNavigation.WebNavigationParentedCallbackDetails): Promise<void> => {
    if (details.frameId !== 0 || this.busy.has(details.tabId) || !isCarrierUrl(details.url)) return;
    let tab: chrome.tabs.Tab | undefined;
    try { tab = await chrome.tabs.get(details.tabId); } catch { return; }
    if (!tab?.active) return;
    await this.ensureHome();
    const config = await this.storage.getPathMappingConfig();
    await this.openLocalSibling({ ...tab, url: details.url }, config);
  };

  /** Machine idle/locked or periodic alarm → re-assert the pairing invariant.
   *  (Catches file tabs opened while the service worker was asleep.) */
  handleIdleState = async (state: chrome.idle.IdleState): Promise<void> => {
    if (state === 'active') return;
    await this.reconcile();
  };

  sweepAtRest = async (): Promise<void> => {
    await this.reconcile();
  };
}
