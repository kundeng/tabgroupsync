import { createChromePromise } from '../utils/promiseUtils';

export async function findBookmarksByTitle(
  title: string
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return createChromePromise<chrome.bookmarks.BookmarkTreeNode[]>((resolve) => {
    chrome.bookmarks.search({ title }, resolve);
  });
}

export async function getBookmarkChildren(
  folderId: string
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return createChromePromise<chrome.bookmarks.BookmarkTreeNode[]>((resolve) => {
    chrome.bookmarks.getChildren(folderId, (children) => resolve(children || []));
  });
}

export async function getBookmark(
  id: string
): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
  return createChromePromise<chrome.bookmarks.BookmarkTreeNode | null>((resolve) => {
    chrome.bookmarks.get(id, ([bookmark]) => resolve(bookmark || null));
  });
}