export async function getBookmark(id: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.get(id, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(results[0] || null);
      }
    });
  });
}

export async function getBookmarkChildren(id: string): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getChildren(id, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(results || []);
      }
    });
  });
}

export async function findBookmarksByTitle(title: string): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.search({ title }, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(results || []);
      }
    });
  });
}
