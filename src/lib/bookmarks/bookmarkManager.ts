import { StorageManager } from '../storage/storageManager';
import { createBookmark, removeBookmark } from './bookmarkMutations';
import { findBookmarksByTitle, getBookmark, getBookmarkChildren } from './bookmarkQueries';
import { Logger } from '../utils/logger';
import { RuntimeMapping } from '../types/storage';
import { BOOKMARK_FOLDERS } from '../constants';

export class BookmarkManager {
  private logger = Logger.getInstance();

  constructor(private readonly storage: StorageManager) {}

  private async findFolderByPath(parentId: string, name: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const children = await chrome.bookmarks.getChildren(parentId);
    return children.find(child => child.title === name && !child.url) || null;
  }

  private async shouldSync(): Promise<boolean> {
    const settings = await this.storage.getSettings();
    return typeof settings.containerFolderId === 'string';
  }

  // Get the Tab Group Bookmarks folder
  async getTabGroupsFolder(): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const settings = await this.storage.getSettings();
    if (!settings.containerFolderId) {
      return null;
    }

    // Bookmark IDs are stable across sessions and synced across devices
    try {
      const folder = await getBookmark(settings.containerFolderId);
      if (folder) {
        return folder;
      }
    } catch (error) {
      this.logger.error('getTabGroupsFolder:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return null;
  }

  // Set up the Tab Group Bookmarks folder structure
  async setupTabGroupsFolder(containerFolder: chrome.bookmarks.BookmarkTreeNode): Promise<chrome.bookmarks.BookmarkTreeNode> {
    // Create the "Tab Group Bookmarks" subfolder if it doesn't exist
    const children = await new Promise<chrome.bookmarks.BookmarkTreeNode[]>((resolve, reject) => {
      chrome.bookmarks.getChildren(containerFolder.id, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });

    let tabGroupsFolder = children.find(child => child.title === BOOKMARK_FOLDERS.TAB_GROUPS && !child.url);
    
    if (!tabGroupsFolder) {
      // Create the subfolder
      tabGroupsFolder = await new Promise<chrome.bookmarks.BookmarkTreeNode>((resolve, reject) => {
        chrome.bookmarks.create({
          parentId: containerFolder.id,
          title: BOOKMARK_FOLDERS.TAB_GROUPS,
          url: undefined
        }, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result);
          }
        });
      });

      this.logger.info('tabGroupFolder:created', {
        containerId: containerFolder.id,
        containerName: containerFolder.title,
        folderId: tabGroupsFolder.id
      });
    } else {
      this.logger.info('tabGroupFolder:reused', {
        containerId: containerFolder.id,
        containerName: containerFolder.title,
        folderId: tabGroupsFolder.id
      });
    }

    // Store the folder ID (stable across sessions and synced across devices)
    await this.storage.updateSettings({ containerFolderId: tabGroupsFolder.id });

    return tabGroupsFolder;
  }

  // Get the Tab Group Bookmarks folder (internal use)
  private async getTabGroupsFolderInternal(): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const folder = await this.getTabGroupsFolder();
    if (!folder) {
      throw new Error('Tab Group Bookmarks folder not found');
    }
    return folder;
  }

  async ensureGroupFolder(name: string): Promise<chrome.bookmarks.BookmarkTreeNode> {
    this.logger.info('ensureGroupFolder:start', { name });
    const tabGroupsFolder = await this.getTabGroupsFolderInternal();
    
    // Check if we already have a folder for this group
    const mapping = await this.storage.getMapping(name);
    this.logger.debug('ensureGroupFolder:mapping', { name, mapping });

    if (mapping?.folderId) {
      const folder = await getBookmark(mapping.folderId);
      if (folder) {
        // Update folder name if it changed
        if (folder.title !== name) {
          await chrome.bookmarks.update(folder.id, { title: name });
          this.logger.info('groupFolder:renamed', {
            name,
            folderId: folder.id,
            oldName: folder.title,
            newName: name
          });
        }
        this.logger.info('groupFolder:found', {
          name,
          folderId: folder.id
        });
        return folder;
      }
      this.logger.warn('groupFolder:missing', {
        name,
        mappingFolderId: mapping.folderId
      });
    }

    // Check for existing folder with same name
    const existingFolders = await chrome.bookmarks.getChildren(tabGroupsFolder.id);
    const existingFolder = existingFolders.find(f => f.title === name);
    
    if (existingFolder) {
      // Use existing folder
      await this.storage.updateMapping(name, {
        name,
        folderId: existingFolder.id,
        syncEnabled: true,
        status: {
          lastSynced: Date.now(),
          inProgress: false
        }
      });
      this.logger.info('groupFolder:reused', {
        name,
        folderId: existingFolder.id
      });
      return existingFolder;
    }

    // Create new folder
    const folder = await createBookmark(tabGroupsFolder.id, name);
    this.logger.info('groupFolder:created', {
      name,
      folderId: folder.id,
      parentId: tabGroupsFolder.id
    });

    // Update mapping
    await this.storage.updateMapping(name, {
      name,
      folderId: folder.id,
      syncEnabled: true,
      status: {
        lastSynced: Date.now(),
        inProgress: false
      }
    });

    return folder;
  }

  async syncGroupToFolder(
    name: string,
    tabs: chrome.tabs.Tab[],
    folderId: string
  ): Promise<void> {
    this.logger.info('sync:started', {
      name,
      folderId,
      tabCount: tabs.length,
      tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title }))
    });

    try {
      // Get the Tab Group Bookmarks folder
      const tabGroupsFolder = await this.getTabGroupsFolderInternal();
      
      // Create or get the folder for this group
      let groupFolder = await this.ensureGroupFolder(name);
      
      // Get existing bookmarks to check for duplicates
      const existingBookmarks = await getBookmarkChildren(groupFolder.id);
      const existingUrls = new Set(existingBookmarks.map(b => b.url));

      // Filter valid tabs and remove duplicates
      const validTabs = tabs
        .map(tab => ({
          title: tab.title || '',
          url: tab.url || tab.pendingUrl
        }))
        .filter((tab): tab is { title: string; url: string } => {
          const isValid = typeof tab.url === 'string';
          if (!isValid) {
            this.logger.debug('sync:invalidTab', {
              url: tab.url
            });
          }
          return isValid && !existingUrls.has(tab.url);
        });

      this.logger.debug('sync:validTabs', {
        count: validTabs.length,
        urls: validTabs.map(t => t.url)
      });

      // Create bookmarks only for new tabs
      const results = await Promise.all(
        validTabs.map(tab =>
          new Promise<chrome.bookmarks.BookmarkTreeNode>((resolve, reject) => {
            chrome.bookmarks.create({
              parentId: groupFolder.id,
              title: tab.title,
              url: tab.url
            }, (result) => {
              if (chrome.runtime.lastError) {
                this.logger.error('sync:createBookmarkFailed', {
                  url: tab.url,
                  error: chrome.runtime.lastError.message
                });
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                this.logger.debug('sync:bookmarkCreated', {
                  bookmarkId: result.id,
                  title: result.title,
                  url: result.url
                });
                resolve(result);
              }
            });
          })
        )
      );

      // Update sync status
      await this.storage.updateMapping(name, {
        status: {
          lastSynced: Date.now(),
          inProgress: false
        }
      });

      this.logger.info('sync:completed', {
        name,
        folderId: groupFolder.id,
        existingCount: existingBookmarks.length,
        addedCount: results.length
      });
    } catch (error) {
      this.logger.error('sync:failed', {
        name,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
      
      // Update sync status to show error
      await this.storage.updateMapping(name, {
        status: {
          lastSynced: Date.now(),
          inProgress: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      
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
      await this.storage.removeMapping(mapping.name);
      this.logger.info('mapping:removed', { 
        name: mapping.name,
        folderId: id,
        reason: 'folder deleted'
      });
    }
  }

  async createUngroupedFolder(): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const folder = await this.getTabGroupsFolderInternal();
    const settings = await this.storage.getUngroupedSettings();
    return createBookmark(folder.id, settings.folderName);
  }

  async syncUngroupedTabs(tabs: chrome.tabs.Tab[]): Promise<void> {
    const settings = await this.storage.getUngroupedSettings();
    if (!settings.folderId) throw new Error('Ungrouped folder not set');

    await this.updateFolderTabs(settings.folderId, tabs);
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
        id: tab.id,
        title: tab.title || '',
        url: tab.url || tab.pendingUrl
      }))
      .filter((tab): tab is { id: number; title: string; url: string } =>
        typeof tab.url === 'string' && !existingUrls.has(tab.url)
      );

    // Add only new bookmarks, never remove existing ones
    await Promise.all(
      validTabs.map(tab =>
        new Promise<chrome.bookmarks.BookmarkTreeNode>((resolve, reject) => {
          chrome.bookmarks.create({
            parentId: folderId,
            title: tab.title,
            url: tab.url
          }, (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(result);
            }
          });
        })
      )
    );
  }
}
