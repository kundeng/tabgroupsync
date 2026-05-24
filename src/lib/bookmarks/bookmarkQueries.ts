/**
 * Bookmark query helpers using promise-based Chrome APIs
 * Chrome Manifest V3 provides native promise support
 */

export async function getBookmark(id: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
  try {
    const results = await chrome.bookmarks.get(id);
    return results[0] || null;
  } catch (error) {
    // Bookmark not found or other error
    return null;
  }
}

export async function getBookmarkChildren(id: string): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  try {
    return await chrome.bookmarks.getChildren(id);
  } catch (error) {
    // Folder not found or other error
    return [];
  }
}

export async function findBookmarksByTitle(title: string): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  try {
    return await chrome.bookmarks.search({ title });
  } catch (error) {
    // Search failed
    return [];
  }
}
