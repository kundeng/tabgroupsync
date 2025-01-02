import { initializeTabGroupListeners } from './listeners/tabGroupListeners';
import { initializeTabListeners } from './listeners/tabListeners';
import { initializeBookmarkListeners } from './listeners/bookmarkListeners';
import { BookmarkManager } from './lib/bookmarkManager';
import { TabGroupManager } from './lib/tabGroupManager';
import { StorageManager } from './lib/storage/storageManager';

// Initialize managers
const storage = new StorageManager();
const bookmarkManager = new BookmarkManager(storage);
const tabGroupManager = new TabGroupManager(bookmarkManager);

// Initialize listeners
initializeTabGroupListeners(tabGroupManager);
initializeTabListeners(tabGroupManager);
initializeBookmarkListeners(bookmarkManager);
