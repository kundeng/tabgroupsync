import { BookmarkManager } from '../lib/bookmarkManager';

export function initializeBookmarkListeners(bookmarkManager: BookmarkManager): void {
  chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
    await bookmarkManager.handleBookmarkCreated(id, bookmark);
  });

  chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
    await bookmarkManager.handleBookmarkRemoved(id, removeInfo);
  });
}