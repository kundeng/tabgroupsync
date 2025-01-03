import { StorageManager } from './storage/storageManager';
import { createBookmark, removeBookmark } from './bookmarks/bookmarkMutations';
import { findBookmarksByTitle, getBookmark, getBookmarkChildren } from './bookmarks/bookmarkQueries';
import { Logger } from './utils/logger';

export class BookmarkManager {
  private logger = Logger.getInstance();

  constructor(private readonly storage: StorageManager) {}

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

  async setParentFolder(folder: chrome.bookmarks.BookmarkTreeNode): Promise<chrome.bookmarks.BookmarkTreeNode> {
    return folder;
  }

  // Folder management
  private async ensureParentFolder(): Promise<string> {
    const settings = await this.storage.getSettings();
    if (!settings.parentFolderId) {
      // Create parent folder if it doesn't exist
      const folder = await createBookmark('1', 'Tab Group Bookmarks');
      await this.storage.updateSettings({ parentFolderId: folder.id });
      this.logger.info('folder:parentCreated', { folderId: folder.id });
      return folder.id;
    }
    return settings.parentFolderId;
  }

  private async ensureGroupFolder(groupId: string, name: string): Promise<string> {
    const parentId = await this.ensureParentFolder();
    
    // Check if we already have a folder for this group
    const mapping = await this.storage.getMapping(groupId);
    if (mapping?.folderId) {
      const folder = await getBookmark(mapping.folderId);
      if (folder) {
        // Update folder name if it changed
        if (folder.title !== name) {
          await chrome.bookmarks.update(folder.id, { title: name });
          this.logger.debug('folder:renamed', {
            groupId,
            folderId: folder.id,
            oldName: folder.title,
            newName: name
          });
        }
        return folder.id;
      }
    }

    // Check for existing folder with same name
    const parent = await getBookmark(parentId);
    if (!parent) throw new Error('Parent folder not found');
    
    const existingFolders = await chrome.bookmarks.getChildren(parentId);
    const existingFolder = existingFolders.find(f => f.title === name);
    
    if (existingFolder) {
      // Use existing folder
      await this.storage.addMapping({
        groupId,
        folderId: existingFolder.id,
        name,
        syncEnabled: true,
        status: {
          lastSynced: Date.now(),
          inProgress: false
        }
      });
      this.logger.info('folder:reused', {
        groupId,
        folderId: existingFolder.id,
        name
      });
      return existingFolder.id;
    }

    // Create new folder
    const folder = await createBookmark(parentId, name);
    this.logger.info('folder:created', {
      groupId,
      folderId: folder.id,
      name
    });

    // Update mapping
    await this.storage.addMapping({
      groupId,
      folderId: folder.id,
      name,
      syncEnabled: true,
      status: {
        lastSynced: Date.now(),
        inProgress: false
      }
    });

    return folder.id;
  }

  async syncGroupToFolder(
    groupId: string,
    tabs: chrome.tabs.Tab[],
    folderName: string
  ): Promise<void> {
    this.logger.debug('sync:started', {
      groupId,
      folderName,
      tabCount: tabs.length
    });

    try {
      const folderId = await this.ensureGroupFolder(groupId, folderName);
      await this.updateFolderTabs(folderId, tabs);

      // Update sync status
      await this.storage.updateMapping(groupId, {
        status: {
          lastSynced: Date.now(),
          inProgress: false
        }
      });

      this.logger.info('sync:completed', {
        groupId,
        folderId,
        folderName,
        tabCount: tabs.length
      });
    } catch (error) {
      this.logger.error('sync:failed', {
        groupId,
        folderName,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async handleBookmarkRemoved(
    id: string,
    removeInfo: { parentId: string; index: number; node: chrome.bookmarks.BookmarkTreeNode }
  ): Promise<void> {
    // Check if the removed bookmark was a group folder
    const mappings = await this.storage.getAllMappings();
    const mapping = Object.values(mappings).find(m => m.folderId === id);
    if (mapping) {
      await this.storage.removeMapping(mapping.groupId);
      this.logger.info('mapping:removed', { 
        groupId: mapping.groupId,
        folderId: id,
        reason: 'folder deleted'
      });
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
    this.logger.debug('fullResync:started', {
      groupId,
      folderName,
      tabCount: tabs.length
    });

    try {
      const folderId = await this.ensureGroupFolder(groupId, folderName);
      const children = await getBookmarkChildren(folderId);
      
      // Remove all existing bookmarks for a clean slate
      await Promise.all(children.map((child) => removeBookmark(child.id)));
      this.logger.debug('fullResync:cleared', {
        groupId,
        folderId,
        removedCount: children.length
      });

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
        validTabs.map(tab => createBookmark(folderId, tab.title, tab.url))
      );

      // Update sync status
      await this.storage.updateMapping(groupId, {
        status: {
          lastSynced: Date.now(),
          inProgress: false
        }
      });

      this.logger.info('fullResync:completed', {
        groupId,
        folderId,
        folderName,
        addedCount: validTabs.length
      });
    } catch (error) {
      this.logger.error('fullResync:failed', {
        groupId,
        folderName,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
      throw error;
    }
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
