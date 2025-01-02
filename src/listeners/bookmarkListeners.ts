import { BookmarkManager } from '../lib/bookmarkManager';
import { Logger } from '../lib/utils/logger';

export function initializeBookmarkListeners(bookmarkManager: BookmarkManager): void {
  const logger = Logger.getInstance();

  // Only handle bookmark removal to clean up mappings
  chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
    logger.debug('bookmark:removed', {
      bookmarkId: id,
      parentId: removeInfo.parentId,
      index: removeInfo.index,
      title: removeInfo.node.title
    });

    try {
      await bookmarkManager.handleBookmarkRemoved(id, removeInfo);
      logger.info('bookmark:removed:handled', {
        bookmarkId: id,
        title: removeInfo.node.title
      });
    } catch (error) {
      logger.error('bookmark:removed:failed', {
        bookmarkId: id,
        title: removeInfo.node.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
    }
  });

  // Log but don't handle other bookmark events for debugging
  chrome.bookmarks.onCreated.addListener((id, bookmark) => {
    logger.debug('bookmark:created', {
      bookmarkId: id,
      parentId: bookmark.parentId,
      title: bookmark.title,
      url: bookmark.url
    });
  });

  chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
    logger.debug('bookmark:changed', {
      bookmarkId: id,
      title: changeInfo.title,
      url: changeInfo.url
    });
  });

  chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
    logger.debug('bookmark:moved', {
      bookmarkId: id,
      oldParentId: moveInfo.oldParentId,
      newParentId: moveInfo.parentId,
      oldIndex: moveInfo.oldIndex,
      newIndex: moveInfo.index
    });
  });

  logger.info('bookmarkListeners:initialized', { timestamp: Date.now() });
}
