import { StorageManager } from './storage/storageManager';
import { createBookmark, removeBookmark } from './bookmarks/bookmarkMutations';
import { findBookmarksByTitle, getBookmark, getBookmarkChildren } from './bookmarks/bookmarkQueries';

export class BookmarkManager {
  private storage: StorageManager;
  private groupFolderMap = new Map<string, string>(); // Maps group IDs (as strings) to folder IDs
  private groupSyncState = new Map<string, boolean>(); // Tracks sync state per group

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

  // Set sync state for a group
  setSyncState(groupId: string, enabled: boolean): void {
    this.groupSyncState.set(groupId, enabled);
  }

  // Get sync state for a group
  getSyncState(groupId: string): boolean {
    return this.groupSyncState.get(groupId) ?? false;
  }

  async syncGroupToFolder(
    groupId: string,
    tabs: chrome.tabs.Tab[],
    folderName: string
  ): Promise<void> {
    // Check both global and group-specific sync settings
    if (!(await this.shouldSync()) || !this.getSyncState(groupId)) return;

    const folder = await this.getOrCreateSubFolder(folderName);
    await this.updateFolderTabs(folder.id, tabs);

    // Update mapping
    this.groupFolderMap.set(groupId, folder.id);
  }

  async handleBookmarkRemoved(
    id: string,
    removeInfo: { parentId: string; index: number; node: chrome.bookmarks.BookmarkTreeNode }
  ): Promise<void> {
    // We only need to update our mappings if a folder is removed
    if (this.groupFolderMap.has(id)) {
      this.groupFolderMap.delete(id);
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

  // Manual full resync that replaces all bookmarks
  async fullResync(
    groupId: string,
    tabs: chrome.tabs.Tab[],
    folderName: string
  ): Promise<void> {
    if (!(await this.shouldSync())) return;

    const folder = await this.getOrCreateSubFolder(folderName);
    const children = await getBookmarkChildren(folder.id);
    
    // Remove all existing bookmarks for a clean slate
    await Promise.all(children.map((child) => removeBookmark(child.id)));

    // Add all current tabs
    const validTabs = tabs
      .map(tab => ({
        title: tab.title || '',
        url: tab.url || tab.pendingUrl
      }))
      .filter((tab): tab is { title: string; url: string } =>
        typeof tab.url === 'string'
      );

    await Promise.all(
      validTabs.map(tab => createBookmark(folder.id, tab.title, tab.url))
    );

    // Update mapping
    this.groupFolderMap.set(groupId, folder.id);
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

  // Only adds new bookmarks, never removes existing ones
  private async updateFolderTabs(
    folderId: string,
    tabs: chrome.tabs.Tab[]
  ): Promise<void> {
    const children = await getBookmarkChildren(folderId);
    const existingUrls = new Set(children.map(child => child.url));

    // Only create bookmarks for new tabs with valid URLs
    const validTabs = tabs
      .map(tab => ({
        title: tab.title || '',
        url: tab.url || tab.pendingUrl
      }))
      .filter((tab): tab is { title: string; url: string } =>
        typeof tab.url === 'string' && !existingUrls.has(tab.url)
      );

    // Add only new bookmarks, never remove existing ones
    await Promise.all(
      validTabs.map(tab => createBookmark(folderId, tab.title, tab.url))
    );
  }
}
