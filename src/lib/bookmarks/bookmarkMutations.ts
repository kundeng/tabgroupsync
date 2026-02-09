/**
 * Bookmark mutation helpers using promise-based Chrome APIs
 * Chrome Manifest V3 provides native promise support
 */

export async function createBookmark(
  parentId: string,
  title: string,
  url?: string
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  return await chrome.bookmarks.create({
    parentId,
    title,
    url
  });
}

export async function updateBookmark(
  id: string,
  changes: { title?: string; url?: string }
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  return await chrome.bookmarks.update(id, changes);
}

export async function removeBookmark(id: string): Promise<void> {
  await chrome.bookmarks.remove(id);
}
