import { initializeTabGroupListeners } from './listeners/tabGroupListeners';
import { initializeTabListeners } from './listeners/tabListeners';
import { initializeBookmarkListeners } from './listeners/bookmarkListeners';
import { BookmarkManager } from './lib/bookmarks/bookmarkManager';
import { TabGroupManager } from './lib/tabGroupManager';
import { StorageManager } from './lib/storage/storageManager';
import { Logger } from './lib/utils/logger';
import { SyncEngine } from './lib/sync/syncEngine';
import { SnapshotManager } from './lib/bookmarks/snapshotManager';
import { scanPrefixCruft, executePrefixCruftCleanup } from './lib/bookmarks/cleanupPrefixCruft';
import { isFileUrl, localize, CARRIER_HOST } from './lib/utils/pathMapper';
import { CarrierTabManager } from './lib/carrierTabManager';

// Initialize logger
const logger = Logger.getInstance();
logger.info('background:init', { timestamp: Date.now() });

declare const self: ServiceWorkerGlobalScope;

// Service worker context
const ctx = self;

// Worker start time for observability
const workerStartTime = Date.now();

// Managers
let storage: StorageManager;
let bookmarkManager: BookmarkManager;
let syncEngine: SyncEngine;
let tabGroupManager: TabGroupManager;
let snapshotManager: SnapshotManager;
let carrierTabManager: CarrierTabManager;
let isReady = false;

// Reentrant initialization guard — deduplicates concurrent init attempts
let initPromise: Promise<boolean> | null = null;

async function ensureInitialized(): Promise<boolean> {
  if (isReady) return true;
  if (initPromise) return initPromise; // Reentrant — await existing init
  initPromise = (async () => {
    try {
      await initializeManagers();
      return true;
    } catch (error) {
      logger.error('ensureInitialized:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  })().then(result => { initPromise = null; return result; });
  return initPromise;
}

// Initialize managers
async function initializeManagers() {
  storage = new StorageManager();
  await storage.initialize();
  
  bookmarkManager = new BookmarkManager(storage);
  syncEngine = new SyncEngine(storage, bookmarkManager, null!);
  tabGroupManager = new TabGroupManager(syncEngine, storage);
  
  // Update syncEngine with tabGroupManager
  Object.assign(syncEngine, { tabGroupManager });
  
  // Initialize managers
  snapshotManager = new SnapshotManager(storage, bookmarkManager);
  carrierTabManager = new CarrierTabManager(storage, logger);

  // Initialize listeners
  initializeTabGroupListeners(tabGroupManager, workerStartTime);
  initializeTabListeners(tabGroupManager);
  initializeBookmarkListeners(bookmarkManager);

  isReady = true;
  logger.info('managers:initialized', { timestamp: Date.now() });
}

// Alarm name constants
const ALARM_PERIODIC_SYNC = 'periodic-sync';
const ALARM_RETRY_INIT = 'retry-init';

// Start periodic sync via chrome.alarms (survives worker termination)
async function startPeriodicSync() {
  const settings = await storage.getSettings();
  
  // Initial sync if configured
  if (settings.containerFolderId) {
    await syncEngine.syncAll();
    logger.info('sync:initial', { timestamp: Date.now() });
  }

  // Create periodic sync alarm (replaces setInterval which is lost on worker termination)
  // chrome.alarms minimum interval is 1 minute; we use 5 minute minimum to avoid quota issues
  const periodInMinutes = Math.max(settings.syncInterval ?? 5, 5);
  await chrome.alarms.create(ALARM_PERIODIC_SYNC, { periodInMinutes });
  logger.info('sync:alarmCreated', { 
    alarm: ALARM_PERIODIC_SYNC, 
    periodInMinutes 
  });
}

// Handle alarm events (fires even after worker termination + restart)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  logger.info('alarm:fired', { name: alarm.name, timestamp: Date.now() });

  if (alarm.name === ALARM_PERIODIC_SYNC) {
    if (!await ensureInitialized()) {
      logger.warn('alarm:notReady', { alarm: alarm.name });
      return;
    }
    try {
      await syncEngine.syncAll();
      await carrierTabManager?.sweepAtRest();
      logger.info('sync:periodic', { timestamp: Date.now() });
    } catch (error) {
      logger.error('sync:periodic:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else if (alarm.name === ALARM_RETRY_INIT) {
    logger.info('alarm:retryInit', { timestamp: Date.now() });
    const success = await ensureInitialized();
    if (success) {
      await chrome.alarms.clear(ALARM_RETRY_INIT);
      logger.info('alarm:retryInit:success', { timestamp: Date.now() });
      // Start periodic sync now that we're initialized
      try {
        await startPeriodicSync();
      } catch (error) {
        logger.error('alarm:retryInit:syncStartFailed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } else {
      // Don't reschedule — this was the one recovery attempt.
      // ensureInitialized will handle on-demand recovery for future events.
      await chrome.alarms.clear(ALARM_RETRY_INIT);
      logger.error('alarm:retryInit:failed', { action: 'giving up, ensureInitialized will handle future events' });
    }
  }
});

// --- Carrier tab management (design-carrier-v3-livetab) ---------------------
// Keep local-file tabs safe from Edge Workspace sync: hold them as https
// carriers at rest, hydrate to file:// on focus, decode carriers on click.
// Listeners are registered top-level (MV3 requirement) and delegate to the
// manager once initialized. onUpdated is pre-filtered to URL changes so we
// don't pay init cost on every tab event.

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url || !isFileUrl(changeInfo.url)) return;
  if (!await ensureInitialized()) return;
  await carrierTabManager.handleUpdated(tabId, changeInfo, tab);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!await ensureInitialized()) return;
  await carrierTabManager.handleActivated(activeInfo);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) return;
  if (!await ensureInitialized()) return;
  await carrierTabManager.handleFocusChanged(windowId);
});

// Decode carrier URLs when navigated (filtered to the carrier host only, so
// this never fires for ordinary browsing).
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (!await ensureInitialized()) return;
    await carrierTabManager.handleBeforeNavigate(details);
  },
  { url: [{ hostEquals: CARRIER_HOST, pathPrefix: '/open' }] }
);

// Initialize state and start sync
async function initializeAndSync() {
  try {
    await initializeManagers();
    logger.info('background:ready', { timestamp: Date.now() });

    // Wait a bit before starting sync to let the browser settle
    setTimeout(async () => {
      try {
        await startPeriodicSync();
        logger.info('sync:started', { timestamp: Date.now() });
      } catch (error) {
        logger.error('sync:start:failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, 5000); // Wait 5 seconds before starting sync
  } catch (error) {
    logger.error('initialization:failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

// Handle connections from popup
chrome.runtime.onConnect.addListener((port) => {
  logger.info('trigger:connect', { 
    name: port.name, 
    timestamp: Date.now()
  });

  port.onMessage.addListener((message) => {
    if (message.type === 'PING') {
      port.postMessage({ type: 'PONG' });
      logger.info('connection:ping', { timestamp: Date.now() });
    }
  });

  port.onDisconnect.addListener(() => {
    logger.info('connection:closed', { 
      name: port.name, 
      timestamp: Date.now() 
    });
  });
});

// Initialize with retries
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

async function initializeWithRetry(attempt = 1) {
  try {
    await initializeAndSync();
  } catch (error) {
    logger.error('initialization:attempt:failed', {
      attempt,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    if (attempt < MAX_RETRIES) {
      logger.info('initialization:retrying', {
        attempt: attempt + 1,
        delay: RETRY_DELAY
      });
      setTimeout(() => initializeWithRetry(attempt + 1), RETRY_DELAY);
    } else {
      // Schedule ONE recovery alarm — then stop. ensureInitialized handles on-demand recovery.
      logger.error('initialization:failed:maxRetries', {
        attempts: MAX_RETRIES,
        action: 'scheduling recovery alarm'
      });
      await chrome.alarms.create(ALARM_RETRY_INIT, { delayInMinutes: 1 });
      logger.info('initialization:recoveryAlarmScheduled', {
        alarm: ALARM_RETRY_INIT,
        delayInMinutes: 1
      });
    }
  }
}

// Start initialization
initializeWithRetry();

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.info('trigger:message', { type: message.type, sender: sender.id, timestamp: Date.now() });

  if (message.type === 'SYNC_ERROR') {
    logger.error('sync:error', message.payload);
  }
  else if (message.type === 'GET_DEBUG_INFO') {
    sendResponse({
      message: 'Debug info available in console logs'
    });
  }
  // Storage operations
  else if (message.type === 'GET_SETTINGS') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const settings = await storage.getSettings();
        sendResponse({ settings });
      } catch (error) {
        logger.error('settings:get:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to get settings' });
      }
    });
  }
  else if (message.type === 'UPDATE_SETTINGS') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        await storage.updateSettings(message.settings);
        sendResponse({ success: true });
      } catch (error) {
        logger.error('settings:update:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to update settings' });
      }
    });
  }

  // Bookmark operations
  else if (message.type === 'GET_TAB_GROUPS_FOLDER') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const folder = await bookmarkManager.getTabGroupsFolder();
        sendResponse({ folder });
      } catch (error) {
        logger.error('folder:get:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to get folder' });
      }
    });
  }
  else if (message.type === 'SETUP_TAB_GROUPS_FOLDER') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const folder = await bookmarkManager.setupTabGroupsFolder(message.containerFolder);
        sendResponse({ folder });
      } catch (error) {
        logger.error('folder:setup:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to setup folder' });
      }
    });
  }

  // Group operations
  else if (message.type === 'GET_ALL_MAPPINGS') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const mappings = await storage.getAllMappings();
        sendResponse({ mappings });
      } catch (error) {
        logger.error('mappings:get:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to get mappings' });
      }
    });
  }
  else if (message.type === 'TOGGLE_SYNC') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        await syncEngine.toggleSync(message.name);
        sendResponse({ success: true });
      } catch (error) {
        logger.error('sync:toggle:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to toggle sync' });
      }
    });
  }
  else if (message.type === 'FULL_RESYNC_GROUP') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        await syncEngine.fullResyncGroup(message.group);
        sendResponse({ success: true });
      } catch (error) {
        logger.error('sync:fullResync:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to resync group' });
      }
    });
  }
  else if (message.type === 'MOVE_GROUP_TO_WINDOW') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }

      try {
        const sourceGroupId = Number(message.sourceGroupId);
        const targetWindowId = Number(message.targetWindowId);
        const sourceGroupName = typeof message.sourceGroupName === 'string'
          ? message.sourceGroupName
          : '';

        if (!Number.isFinite(sourceGroupId) || !Number.isFinite(targetWindowId) || !sourceGroupName.trim()) {
          sendResponse({ error: 'Invalid move request payload' });
          return;
        }

        const sourceGroup = await tabGroupManager.getGroup(sourceGroupId);
        if (!sourceGroup) {
          sendResponse({ error: 'Source group not found' });
          return;
        }

        if (sourceGroup.windowId === targetWindowId) {
          sendResponse({ error: 'Target window must be different from source window' });
          return;
        }

        const allWindows = await chrome.windows.getAll({ populate: false });
        const targetExists = allWindows.some((window) => window.id === targetWindowId);
        if (!targetExists) {
          sendResponse({ error: 'Target window not found' });
          return;
        }

        const result = await tabGroupManager.moveGroupToWindow({
          sourceGroupId,
          sourceGroupName,
          targetWindowId
        });

        sendResponse({ success: true, result });
      } catch (error) {
        logger.error('group:move:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to move group' });
      }
    });
  }
  else if (message.type === 'SYNC_ALL') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        await syncEngine.syncAll();
        sendResponse({ success: true });
      } catch (error) {
        logger.error('sync:all:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to sync all' });
      }
    });
  }

  // Snapshot operations
  else if (message.type === 'LIST_SNAPSHOTS') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const snapshots = await snapshotManager.listSnapshots(message.groupId);
        sendResponse({ snapshots });
      } catch (error) {
        logger.error('snapshots:list:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to list snapshots' });
      }
    });
  }
  else if (message.type === 'CREATE_SNAPSHOT') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const snapshot = await snapshotManager.createSnapshot(message.groupId, message.groupName);
        sendResponse({ snapshot });
      } catch (error) {
        logger.error('snapshot:create:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to create snapshot' });
      }
    });
  }
  else if (message.type === 'DELETE_SNAPSHOT') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        await snapshotManager.deleteSnapshot(message.snapshotId);
        sendResponse({ success: true });
      } catch (error) {
        logger.error('snapshot:delete:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to delete snapshot' });
      }
    });
  }
  else if (message.type === 'RESTORE_SNAPSHOT') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const result = await snapshotManager.restoreSnapshot(message.snapshotId);
        sendResponse({ result });
      } catch (error) {
        logger.error('snapshot:restore:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to restore snapshot' });
      }
    });
  }
  else if (message.type === 'GET_GROUP_SYNC_SETTINGS') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const settings = await storage.getGroupSyncSettings(message.name);
        sendResponse({ settings });
      } catch (error) {
        logger.error('groupSyncSettings:get:failed', {
          name: message.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to get group sync settings' });
      }
    });
  }
  else if (message.type === 'EXPORT_DATA') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const settings = await storage.getSettings();
        const folder = await bookmarkManager.getTabGroupsFolder();

        let groups: Array<{ name: string; urls: Array<{ title: string; url: string }> }> = [];
        if (folder) {
          const children = await chrome.bookmarks.getChildren(folder.id);
          for (const child of children) {
            if (child.url) continue; // Skip non-folders
            const bookmarks = await chrome.bookmarks.getChildren(child.id);
            groups.push({
              name: child.title,
              urls: bookmarks
                .filter(b => b.url)
                .map(b => ({ title: b.title, url: b.url! })),
            });
          }
        }

        const exportData = {
          version: chrome.runtime.getManifest().version,
          exportedAt: new Date().toISOString(),
          settings: {
            autoSync: settings.autoSync,
            cleanup: settings.cleanup,
          },
          groups,
        };

        sendResponse({ data: exportData });
      } catch (error) {
        logger.error('export:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to export data' });
      }
    });
  }
  else if (message.type === 'IMPORT_DATA') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const importData = message.data;
        if (!importData?.groups || !Array.isArray(importData.groups)) {
          sendResponse({ error: 'Invalid import data format' });
          return;
        }

        const folder = await bookmarkManager.getTabGroupsFolder();
        if (!folder) {
          sendResponse({ error: 'Please set up a backup location first' });
          return;
        }

        let imported = 0;
        for (const group of importData.groups) {
          if (!group.name || !Array.isArray(group.urls)) continue;

          // Check if folder already exists
          const existing = await chrome.bookmarks.getChildren(folder.id);
          let groupFolder = existing.find(f => f.title === group.name);

          if (!groupFolder) {
            groupFolder = await chrome.bookmarks.create({
              parentId: folder.id,
              title: group.name,
            });
          }

          for (const bookmark of group.urls) {
            if (!bookmark.url) continue;
            await chrome.bookmarks.create({
              parentId: groupFolder.id,
              title: bookmark.title || bookmark.url,
              url: bookmark.url,
            });
          }
          imported++;
        }

        logger.info('import:completed', { groupCount: imported });
        sendResponse({ success: true, imported });
      } catch (error) {
        logger.error('import:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to import data' });
      }
    });
  }
  else if (message.type === 'RESTORE_GROUP_FROM_BOOKMARKS') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const { folderId, groupName } = message;
        if (!folderId || !groupName) {
          sendResponse({ error: 'Missing folder ID or group name' });
          return;
        }

        // Get bookmarks from the folder
        const bookmarks = await chrome.bookmarks.getChildren(folderId);
        const urls = bookmarks.filter(b => b.url).map(b => b.url!);

        if (urls.length === 0) {
          sendResponse({ error: 'No bookmarks found in this group folder' });
          return;
        }

        // Create tabs for each URL, applying path mapping for file:// URLs
        const mappingConfig = await storage.getPathMappingConfig();
        const createdTabs: chrome.tabs.Tab[] = [];
        for (const url of urls) {
          const resolvedUrl = isFileUrl(url) ? localize(url, mappingConfig) : url;
          try {
            const tab = await chrome.tabs.create({ url: resolvedUrl, active: false });
            createdTabs.push(tab);
          } catch (error) {
            if (isFileUrl(resolvedUrl)) {
              const openerUrl = chrome.runtime.getURL('opener.html')
                + '?target=' + encodeURIComponent(resolvedUrl)
                + '&original=' + encodeURIComponent(url);
              const tab = await chrome.tabs.create({ url: openerUrl, active: false });
              createdTabs.push(tab);
              logger.warn('restore:fileUrlFallback', { resolvedUrl, original: url });
            } else {
              throw error;
            }
          }
        }

        // Group the tabs
        if (createdTabs.length > 0) {
          const tabIds = createdTabs.map(t => t.id!).filter(id => id !== undefined);
          const groupId = await chrome.tabs.group({ tabIds });

          // Set group properties
          await chrome.tabGroups.update(groupId, {
            title: groupName,
            collapsed: false,
          });

          logger.info('restore:fromBookmarks:completed', {
            groupName,
            tabCount: tabIds.length
          });
          sendResponse({ success: true, groupId, tabCount: tabIds.length });
        } else {
          sendResponse({ error: 'Failed to create tabs' });
        }
      } catch (error) {
        logger.error('restore:fromBookmarks:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to restore group' });
      }
    });
  }
  else if (message.type === 'RESTORE_FILE_URLS') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const mappingConfig = await storage.getPathMappingConfig();
        const settings = await storage.getSettings();
        if (!settings.containerFolderId) {
          sendResponse({ error: 'No container folder configured' });
          return;
        }

        const tgbFolder = await bookmarkManager.getTabGroupsFolder();
        if (!tgbFolder) {
          sendResponse({ error: 'Tab Group Bookmarks folder not found' });
          return;
        }

        const groups = await chrome.bookmarks.getChildren(tgbFolder.id);
        let totalOpened = 0;

        // Find existing tab groups by name
        const allTabGroups = await chrome.tabGroups.query({});
        const groupByName: Record<string, number> = {};
        for (const tg of allTabGroups) {
          if (tg.title) groupByName[tg.title] = tg.id;
        }

        for (const group of groups) {
          if (group.url) continue;
          const bookmarks = await chrome.bookmarks.getChildren(group.id);
          const fileUrls = bookmarks.filter(b => b.url && isFileUrl(b.url));
          if (fileUrls.length === 0) continue;

          // Check which file URLs are already open in the existing group
          let existingTabUrls = new Set<string>();
          if (groupByName[group.title]) {
            const existingTabs = await chrome.tabs.query({ groupId: groupByName[group.title] });
            existingTabUrls = new Set(existingTabs.map(t => t.url || ''));
          }

          const createdTabs: chrome.tabs.Tab[] = [];
          for (const bm of fileUrls) {
            const resolvedUrl = localize(bm.url!, mappingConfig);
            if (existingTabUrls.has(resolvedUrl)) continue;
            try {
              const tab = await chrome.tabs.create({ url: resolvedUrl, active: false });
              createdTabs.push(tab);
            } catch {
              const openerUrl = chrome.runtime.getURL('opener.html')
                + '?target=' + encodeURIComponent(resolvedUrl)
                + '&original=' + encodeURIComponent(bm.url!);
              const tab = await chrome.tabs.create({ url: openerUrl, active: false });
              createdTabs.push(tab);
            }
          }

          if (createdTabs.length > 0) {
            const tabIds = createdTabs.map(t => t.id!).filter(id => id !== undefined);
            if (groupByName[group.title]) {
              await chrome.tabs.group({ tabIds, groupId: groupByName[group.title] });
            } else {
              const groupId = await chrome.tabs.group({ tabIds });
              await chrome.tabGroups.update(groupId, { title: group.title, collapsed: true });
            }
            totalOpened += tabIds.length;
          }
        }

        logger.info('restore:fileUrls:completed', { totalOpened });
        sendResponse({ success: true, totalOpened });
      } catch (error) {
        logger.error('restore:fileUrls:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to restore file URLs' });
      }
    });
  }
  else if (message.type === 'RESTORE_GROUP_FILE_URLS') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const { folderId, groupName } = message;
        if (!folderId) {
          sendResponse({ error: 'Missing folder ID' });
          return;
        }

        const mappingConfig = await storage.getPathMappingConfig();
        const bookmarks = await chrome.bookmarks.getChildren(folderId);
        const fileUrls = bookmarks.filter(b => b.url && isFileUrl(b.url));

        if (fileUrls.length === 0) {
          sendResponse({ success: true, totalOpened: 0 });
          return;
        }

        // Find existing group and its open tabs
        const allTabGroups = await chrome.tabGroups.query({});
        const existingGroup = allTabGroups.find(g => g.title === groupName);
        let existingTabUrls = new Set<string>();
        if (existingGroup) {
          const tabs = await chrome.tabs.query({ groupId: existingGroup.id });
          existingTabUrls = new Set(tabs.map(t => t.url || ''));
        }

        const createdTabs: chrome.tabs.Tab[] = [];
        for (const bm of fileUrls) {
          const resolvedUrl = localize(bm.url!, mappingConfig);
          if (existingTabUrls.has(resolvedUrl)) continue;
          try {
            const tab = await chrome.tabs.create({ url: resolvedUrl, active: false });
            createdTabs.push(tab);
          } catch {
            const openerUrl = chrome.runtime.getURL('opener.html')
              + '?target=' + encodeURIComponent(resolvedUrl)
              + '&original=' + encodeURIComponent(bm.url!);
            const tab = await chrome.tabs.create({ url: openerUrl, active: false });
            createdTabs.push(tab);
          }
        }

        if (createdTabs.length > 0) {
          const tabIds = createdTabs.map(t => t.id!).filter(id => id !== undefined);
          if (existingGroup) {
            await chrome.tabs.group({ tabIds, groupId: existingGroup.id });
          } else {
            const gid = await chrome.tabs.group({ tabIds });
            await chrome.tabGroups.update(gid, { title: groupName, collapsed: true });
          }
        }

        sendResponse({ success: true, totalOpened: createdTabs.length });
      } catch (error) {
        logger.error('restore:groupFileUrls:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed' });
      }
    });
  }
  else if (message.type === 'GET_HISTORY') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const history = await storage.getHistory();
        sendResponse({ history });
      } catch (error) {
        logger.error('history:get:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to get history' });
      }
    });
  }
  else if (message.type === 'SCAN_PREFIX_CRUFT') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const result = await scanPrefixCruft(storage);
        sendResponse({ result });
      } catch (error) {
        logger.error('cleanup:scan:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Scan failed' });
      }
    });
  }
  else if (message.type === 'EXECUTE_PREFIX_CRUFT_CLEANUP') {
    Promise.resolve().then(async () => {
      if (!await ensureInitialized()) {
        sendResponse({ error: 'Extension failed to initialize' });
        return;
      }
      try {
        const result = await executePrefixCruftCleanup(message.candidates);
        sendResponse({ result });
      } catch (error) {
        logger.error('cleanup:execute:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Cleanup failed' });
      }
    });
  }
  return true; // Keep message channel open for async response
});

// Debug tools (only in development)
if (import.meta.env.DEV) {
  // @ts-ignore
  ctx.debugTools = {
    logger: logger,
    storage: () => storage,
    bookmarkManager: () => bookmarkManager,
    syncEngine: () => syncEngine
  };
}

// Catch unhandled promise rejections — log only, no automatic recovery
ctx.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const error = event.reason;
  logger.error('worker:unhandledRejection', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: Date.now()
  });
});

// Service worker lifecycle management
ctx.addEventListener('install', (event: ExtendableEvent) => {
  logger.info('serviceWorker:install', { timestamp: Date.now() });
  // Skip waiting to become active immediately
  event.waitUntil(ctx.skipWaiting());
});

// Open welcome page on first install (not on updates)
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    logger.info('onboarding:welcomePageOpened', { timestamp: Date.now() });
  }
});

ctx.addEventListener('activate', (event: ExtendableEvent) => {
  logger.info('serviceWorker:activate', { timestamp: Date.now() });
  // Take control of all clients and reinitialize state
  event.waitUntil((async () => {
    await ctx.clients.claim();
    
    // Reinitialize managers and ensure alarm exists
    try {
      await initializeManagers();
      logger.info('serviceWorker:reinitialized', { timestamp: Date.now() });

      // Ensure periodic sync alarm exists (it persists across worker restarts,
      // but re-create on activate to handle extension updates)
      await startPeriodicSync();
      
      logger.info('serviceWorker:activated', { timestamp: Date.now() });
    } catch (error) {
      logger.error('serviceWorker:reinitializationFailed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })());
});

// Handle worker updates
ctx.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    logger.info('serviceWorker:skipWaiting', { timestamp: Date.now() });
    ctx.skipWaiting();
  }
});
