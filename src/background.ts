import { initializeTabGroupListeners } from './listeners/tabGroupListeners';
import { initializeTabListeners } from './listeners/tabListeners';
import { initializeBookmarkListeners } from './listeners/bookmarkListeners';
import { BookmarkManager } from './lib/bookmarkManager';
import { TabGroupManager } from './lib/tabGroupManager';
import { StorageManager } from './lib/storage/storageManager';
import { Logger, LogLevel } from './lib/utils/logger';
import { SyncEngine } from './lib/sync/syncEngine';

// Initialize logger
const logger = Logger.getInstance();
logger.info('background:init', { timestamp: Date.now() });

// Initialize managers
const storage = new StorageManager();
const bookmarkManager = new BookmarkManager(storage);
const tabGroupManager = new TabGroupManager(bookmarkManager);
const syncEngine = new SyncEngine(storage, bookmarkManager, tabGroupManager);

// Initialize listeners
try {
  logger.debug('background:initListeners', { status: 'starting' });
  
  initializeTabGroupListeners(tabGroupManager);
  initializeTabListeners(tabGroupManager);
  initializeBookmarkListeners(bookmarkManager);
  
  logger.info('background:initListeners', { status: 'complete' });
} catch (error) {
  logger.error('background:initListeners', { 
    status: 'failed',
    error: error instanceof Error ? error.message : 'Unknown error'
  }, error instanceof Error ? error : undefined);
}

// Listen for extension lifecycle events
chrome.runtime.onStartup.addListener(() => {
  logger.info('extension:startup', { timestamp: Date.now() });
});

chrome.runtime.onInstalled.addListener((details) => {
  logger.info('extension:installed', { 
    reason: details.reason,
    previousVersion: details.previousVersion,
    timestamp: Date.now()
  });
});

// Listen for sync errors
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SYNC_ERROR') {
    logger.error('sync:error', message.payload);
  }
});

// Export for debugging
(window as any).debugTools = {
  getLogs: () => logger.getRecentLogs(),
  getErrorLogs: () => logger.getLogsByLevel(LogLevel.ERROR),
  getSyncLogs: () => logger.getLogsByOperation('sync'),
  clearLogs: () => logger.clearLogs(),
  exportLogs: () => logger.exportLogs(),
  syncEngine
};

logger.info('background:ready', { timestamp: Date.now() });
