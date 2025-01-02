import { createChromePromise } from '../utils/promiseUtils';

export async function createBookmark(
  parentId: string,
  title: string,
  url?: string
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  return createChromePromise<chrome.bookmarks.BookmarkTreeNode>((resolve) => {
    chrome.bookmarks.create({ parentId, title, url }, resolve);
  });
}

export async function removeBookmark(id: string): Promise<void> {
  return createChromePromise<void>((resolve) => {
    chrome.bookmarks.remove(id, () => resolve());
  });
}