import { initializeTabGroupListeners } from './listeners/tabGroupListeners';
import { initializeTabListeners } from './listeners/tabListeners';
import { initializeBookmarkListeners } from './listeners/bookmarkListeners';
import { BookmarkManager } from './lib/bookmarks/bookmarkManager';
import { TabGroupManager } from './lib/tabGroupManager';
import { StorageManager } from './lib/storage/storageManager';
import { Logger, LogLevel } from './lib/utils/logger';
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

// Start periodic sync
async function startPeriodicSync() {
  const settings = await storage.getSettings();
  
  // Initial sync if configured
  if (settings.containerFolderId) {
    await syncEngine.syncAll();
    logger.info('sync:initial', { timestamp: Date.now() });
  }

  // Start periodic sync if enabled
  if (settings.syncInterval) {
    // Use 5 minute minimum interval to avoid quota issues
    const interval = Math.max(settings.syncInterval, 5) * 60 * 1000;
    
    setInterval(async () => {
      try {
        await syncEngine.syncAll();
        logger.info('sync:periodic', { 
          timestamp: Date.now(),
          interval: interval / 60000 // Log interval in minutes
        });
      } catch (error) {
        logger.error('sync:periodic:failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, interval);
  }
}

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
  logger.info('connection:received', { 
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
      logger.error('initialization:failed:maxRetries', {
        attempts: MAX_RETRIES
      });
    }
  }
}

// Start initialization
initializeWithRetry();

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_ERROR') {
    logger.error('sync:error', message.payload);
  }
  else if (message.type === 'GET_DEBUG_INFO') {
    sendResponse({
      logs: logger.getRecentLogs(),
      errorLogs: logger.getLogsByLevel(LogLevel.ERROR),
      syncLogs: logger.getLogsByOperation('sync')
    });
  }
  // Storage operations
  else if (message.type === 'GET_SETTINGS') {
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
      try {
        await snapshotManager.deleteSnapshot(message.snapshotId);
        sendResponse({ success: true });
      } catch (error) {
        logger.error('snapshot:delete:failed', { error });
        sendResponse({ error: error instanceof Error ? error.message : 'Failed to delete snapshot' });
      }
    });
  }
  else if (message.type === 'GET_GROUP_SYNC_SETTINGS') {
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    if (!isReady) {
      sendResponse({ error: 'Background service not ready' });
      return true;
    }
    Promise.resolve().then(async () => {
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
    getLogs: () => logger.getRecentLogs(),
    getErrorLogs: () => logger.getLogsByLevel(LogLevel.ERROR),
    getSyncLogs: () => logger.getLogsByOperation('sync'),
    clearLogs: () => logger.clearLogs(),
    exportLogs: () => logger.exportLogs()
  };
}

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
    
    // Reinitialize managers and state
    try {
      await initializeManagers();
      logger.info('serviceWorker:reinitialized', { timestamp: Date.now() });

      // Get all preference keys
      const allKeys = await new Promise<{ [key: string]: any }>(resolve => {
        chrome.storage.sync.get(null, resolve);
      });

      // Extract enabled groups
      const enabledGroups = Object.entries(allKeys)
        .filter(([key, value]) => key.startsWith('pref:') && value.syncEnabled)
        .map(([key]) => key.slice(5)); // Remove 'pref:' prefix

      // Only update runtime state, no storage writes needed
      enabledGroups.forEach(name => {
        storage.updateRuntimeMapping(name, {
          name,
          folderId: '',  // Will be set when syncing
          syncEnabled: true,
          status: {
            lastSynced: 0,
            inProgress: false
          }
        });
      });
      
      // Start periodic sync which will handle all groups
      await startPeriodicSync();
      
      logger.info('serviceWorker:syncPreferencesRestored', {
        preferences: enabledGroups.length
      });
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
