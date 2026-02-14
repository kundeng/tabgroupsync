import { initializeTabGroupListeners } from './listeners/tabGroupListeners';
import { initializeTabListeners } from './listeners/tabListeners';
import { initializeBookmarkListeners } from './listeners/bookmarkListeners';
import { BookmarkManager } from './lib/bookmarks/bookmarkManager';
import { TabGroupManager } from './lib/tabGroupManager';
import { StorageManager } from './lib/storage/storageManager';
import { Logger } from './lib/utils/logger';
import { SyncEngine } from './lib/sync/syncEngine';
import { SnapshotManager } from './lib/bookmarks/snapshotManager';

// Initialize logger
const logger = Logger.getInstance();
logger.info('background:init', { timestamp: Date.now() });

declare const self: ServiceWorkerGlobalScope;

// Service worker context
const ctx = self;

// Managers
let storage: StorageManager;
let bookmarkManager: BookmarkManager;
let syncEngine: SyncEngine;
let tabGroupManager: TabGroupManager;
let snapshotManager: SnapshotManager;
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
  
  // Initialize listeners
  initializeTabGroupListeners(tabGroupManager);
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
