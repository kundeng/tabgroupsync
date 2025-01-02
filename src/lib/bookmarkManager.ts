import { StorageManager } from './storage/storageManager';
import { createBookmark, removeBookmark } from './bookmarks/bookmarkMutations';
import { findBookmarksByTitle, getBookmark, getBookmarkChildren } from './bookmarks/bookmarkQueries';

export class BookmarkManager {
  private storage: StorageManager;
  private groupFolderMap: Map<number, string> = new Map(); // Maps group IDs to folder IDs
  private folderGroupMap: Map<string, number> = new Map(); // Maps folder IDs to group IDs

  constructor(storage: StorageManager) {
    this.storage = storage;
  }

  private async shouldSync(): Promise<boolean> {
    const settings = await this.storage.getSettings();
    return settings.autoSync && typeof settings.parentFolderId === 'string';
  }

  async getParentFolder(): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const settings = await this.storage.getSettings();
    const parentFolderId = settings.parentFolderId;
    if (!parentFolderId || typeof parentFolderId !== 'string') {
      return null;
    }
    return getBookmark(parentFolderId);
  }

  async createSubFolder(name: string): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const parent = await this.getParentFolder();
    if (!parent) throw new Error('Parent folder not set');
    return createBookmark(parent.id, name);
  }

  async syncGroupToFolder(
    groupId: number,
    tabs: chrome.tabs.Tab[],
    folderName: string
  ): Promise<void> {
    if (!(await this.shouldSync())) return;

    const folder = await this.getOrCreateSubFolder(folderName);
    await this.updateFolderTabs(folder.id, tabs);

    // Update mappings
    this.groupFolderMap.set(groupId, folder.id);
    this.folderGroupMap.set(folder.id, groupId);
  }

  async handleBookmarkCreated(
    id: string,
    bookmark: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    if (!(await this.shouldSync())) return;

    const parentFolder = await this.getParentFolder();
    if (!parentFolder) return;

    // Only handle bookmarks created in subfolders of our parent folder
    if (!bookmark.parentId) return;
    const parent = await getBookmark(bookmark.parentId);
    if (!parent || parent.parentId !== parentFolder.id) return;

    // If this is a new folder under our parent, it might represent a new tab group
    if (!bookmark.url) {
      await this.createTabGroupFromFolder(bookmark.id);
    }
  }

  async handleBookmarkRemoved(
    id: string,
    removeInfo: { parentId: string; index: number; node: chrome.bookmarks.BookmarkTreeNode }
  ): Promise<void> {
    if (!(await this.shouldSync())) return;

    // If a folder was removed and it was mapped to a group, remove the mapping
    if (this.folderGroupMap.has(id)) {
      const groupId = this.folderGroupMap.get(id)!;
      this.folderGroupMap.delete(id);
      this.groupFolderMap.delete(groupId);
    }
  }

  async createUngroupedFolder(): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const parent = await this.getParentFolder();
    if (!parent) throw new Error('Parent folder not set');
    
    const settings = await this.storage.getUngroupedSettings();
    return createBookmark(parent.id, settings.folderName);
  }

  async syncUngroupedTabs(tabs: chrome.tabs.Tab[]): Promise<void> {
    const settings = await this.storage.getUngroupedSettings();
    if (!settings.folderId) throw new Error('Ungrouped folder not set');

    await this.updateFolderTabs(settings.folderId, tabs);
  }

  async createTabGroupFromFolder(folderId: string): Promise<void> {
    const folder = await getBookmark(folderId);
    if (!folder) throw new Error('Folder not found');
    const bookmarks = await getBookmarkChildren(folder.id);
    if (bookmarks.length === 0) return;

    // Create a new window with the bookmarked tabs
    const window = await chrome.windows.create({ focused: false });
    const tabs: chrome.tabs.Tab[] = [];

    // Create tabs for each bookmark
    for (const bookmark of bookmarks) {
      if (bookmark.url) {
        const tab = await chrome.tabs.create({
          url: bookmark.url,
          windowId: window.id,
          active: false
        });
        tabs.push(tab);
      }
    }

    // Create a new tab group for these tabs
    if (tabs.length > 0) {
      const groupId = await chrome.tabs.group({
        tabIds: tabs.map(tab => tab.id!),
        createProperties: { windowId: window.id }
      });

      // Update the group title
      await chrome.tabGroups.update(groupId, { title: folder.title });

      // Store the mapping
      this.groupFolderMap.set(groupId, folder.id);
      this.folderGroupMap.set(folder.id, groupId);
    }
  }

  private async getOrCreateSubFolder(
    name: string
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const parent = await this.getParentFolder();
    if (!parent) throw new Error('Parent folder not set');

    const results = await findBookmarksByTitle(name);
    const existing = results.find((b) => b.parentId === parent.id);
    
    return existing || createBookmark(parent.id, name);
  }

  private async updateFolderTabs(
    folderId: string,
    tabs: chrome.tabs.Tab[]
  ): Promise<void> {
    const children = await getBookmarkChildren(folderId);
    await Promise.all(children.map((child) => removeBookmark(child.id)));
    // Only create bookmarks for tabs with valid URLs
    const validTabs = tabs
      .map(tab => ({
        title: tab.title || '',
        url: tab.url || tab.pendingUrl
      }))
      .filter((tab): tab is { title: string; url: string } => 
        typeof tab.url === 'string'
      );

    await Promise.all(
      validTabs.map(tab => createBookmark(folderId, tab.title, tab.url))
    );
  }
}
