import { StorageManager } from '../storage/storageManager';
import { createBookmark, removeBookmark, updateBookmark } from './bookmarkMutations';
import { findBookmarksByTitle, getBookmark, getBookmarkChildren } from './bookmarkQueries';
import { Logger } from '../utils/logger';
import { RuntimeMapping } from '../types/storage';
import { BOOKMARK_FOLDERS } from '../constants';

export class BookmarkManager {
  private logger = Logger.getInstance();

  constructor(private readonly storage: StorageManager) {}

  private async findFolderByPath(parentId: string, name: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const children = await getBookmarkChildren(parentId);
    return children.find(child => child.title === name && !child.url) || null;
  }

  private async shouldSync(): Promise<boolean> {
    const settings = await this.storage.getSettings();
    return typeof settings.containerFolderId === 'string';
  }

  // Create a new container folder at the same location as the previous one
  async createContainerFolder(): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const settings = await this.storage.getSettings();
    if (!settings.containerFolderId) {
      throw new Error('Container folder ID not set');
    }

    try {
      // Get the old folder to find its parent
      const oldFolder = await getBookmark(settings.containerFolderId);
      const parentId = oldFolder?.parentId || '1'; // Default to bookmarks bar if parent not found

      // Create new container folder at the same location with same name
      const folder = await createBookmark(parentId, oldFolder?.title || 'Tab Groups');
      
      this.logger.info('containerFolder:recreated', {
        folderId: folder.id,
        parentId
      });

      return folder;
    } catch (error) {
      this.logger.error('createContainerFolder:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // Get the user-selected container folder
  async getContainerFolder(): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const settings = await this.storage.getSettings();
    if (!settings.containerFolderId) {
      return null;
    }

    try {
      const folder = await getBookmark(settings.containerFolderId);
      if (!folder) return null;

      // Check if this folder is nested under another sync folder
      let current = folder;
      let depth = 0;
      const MAX_DEPTH = 5;
      
      while (current.parentId && depth < MAX_DEPTH) {
        const parent = await getBookmark(current.parentId);
        if (!parent) break;
        
        // Check if parent has both intermediate folders
        const siblings = await getBookmarkChildren(parent.id);
        const parentBookmarksFolder = siblings.find(s => !s.url && s.title === BOOKMARK_FOLDERS.BOOKMARKS);
        const parentSnapshotsFolder = siblings.find(s => !s.url && s.title === BOOKMARK_FOLDERS.SNAPSHOTS);
        
        if (parentBookmarksFolder && parentSnapshotsFolder) {
          // Found a parent that's already a container, use it
          this.logger.warn('container:nestedUnderSync', {
            folderId: folder.id,
            parentId: parent.id,
            action: 'using parent'
          });
          
          await this.storage.updateSettings({ containerFolderId: parent.id, containerFolderName: parent.title });
          return parent;
        }
        
        current = parent;
        depth++;
      }

      return folder;
    } catch (error) {
      this.logger.error('getContainerFolder:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  // Ensure container folder exists with proper structure validation
  async ensureContainerFolderExists(): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const container = await this.getContainerFolder();
    
    if (!container) {
      throw new Error('Container folder not configured. Please select a location for your bookmarks.');
    }

    // Validate folder structure
    try {
      const children = await getBookmarkChildren(container.id);
      const bookmarksFolder = children.find(c => !c.url && c.title === BOOKMARK_FOLDERS.BOOKMARKS);
      const snapshotsFolder = children.find(c => !c.url && c.title === BOOKMARK_FOLDERS.SNAPSHOTS);

      // If structure is incomplete, repair it
      if (!bookmarksFolder || !snapshotsFolder) {
        this.logger.logDecision(
          'Repairing container folder structure',
          'Container folder exists but intermediate folders are missing',
          { 
            containerId: container.id,
            hasBookmarksFolder: !!bookmarksFolder,
            hasSnapshotsFolder: !!snapshotsFolder
          }
        );

        if (!bookmarksFolder) {
          await createBookmark(container.id, BOOKMARK_FOLDERS.BOOKMARKS);
        }
        if (!snapshotsFolder) {
          await createBookmark(container.id, BOOKMARK_FOLDERS.SNAPSHOTS);
        }
      }

      return container;
    } catch (error) {
      this.logger.error('ensureContainerFolderExists:validation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        containerId: container.id
      });
      throw error;
    }
  }

  // Get the Tab Group Bookmarks folder inside the container
  async getTabGroupsFolder(): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const container = await this.getContainerFolder();
    if (!container) {
      return null;
    }

    try {
      // Try to find existing bookmarks folder
      const children = await getBookmarkChildren(container.id);
      const bookmarksFolder = children.find(child => child.title === BOOKMARK_FOLDERS.BOOKMARKS && !child.url);
      if (bookmarksFolder) {
        // Ensure snapshots folder exists alongside
        const hasSnapshotsFolder = children.find(child => child.title === BOOKMARK_FOLDERS.SNAPSHOTS && !child.url);
        if (!hasSnapshotsFolder) {
          await createBookmark(container.id, BOOKMARK_FOLDERS.SNAPSHOTS);
        }
        return bookmarksFolder;
      }

      // Create both folders if neither exists
      const newBookmarksFolder = await createBookmark(container.id, BOOKMARK_FOLDERS.BOOKMARKS);
      await createBookmark(container.id, BOOKMARK_FOLDERS.SNAPSHOTS);
      return newBookmarksFolder;
    } catch (error) {
      this.logger.error('getTabGroupsFolder:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  // Set up the user-selected container folder and ensure proper structure
  async setupTabGroupsFolder(folder: chrome.bookmarks.BookmarkTreeNode): Promise<chrome.bookmarks.BookmarkTreeNode> {
    // First check if this folder already has the intermediate folders
    const children = await getBookmarkChildren(folder.id);
    const bookmarksFolder = children.find(c => !c.url && c.title === BOOKMARK_FOLDERS.BOOKMARKS);
    const snapshotsFolder = children.find(c => !c.url && c.title === BOOKMARK_FOLDERS.SNAPSHOTS);

    if (bookmarksFolder && snapshotsFolder) {
      // Already set up correctly
      await this.storage.updateSettings({ containerFolderId: folder.id, containerFolderName: folder.title });
      return bookmarksFolder;
    }

    // Check if this folder is inside an existing container
    let current = folder;
    let depth = 0;
    const MAX_DEPTH = 5;

    while (current.parentId && depth < MAX_DEPTH) {
      const parent = await getBookmark(current.parentId);
      if (!parent) break;

      const siblings = await getBookmarkChildren(parent.id);
      const parentBookmarksFolder = siblings.find(s => !s.url && s.title === BOOKMARK_FOLDERS.BOOKMARKS);
      const parentSnapshotsFolder = siblings.find(s => !s.url && s.title === BOOKMARK_FOLDERS.SNAPSHOTS);

      if (parentBookmarksFolder && parentSnapshotsFolder) {
        // Found a parent that's already a container, use it
        this.logger.warn('container:nestedSetup', {
          folderId: folder.id,
          parentId: parent.id,
          action: 'using parent'
        });
        await this.storage.updateSettings({ containerFolderId: parent.id, containerFolderName: parent.title });
        return parentBookmarksFolder;
      }

      current = parent;
      depth++;
    }

    // No existing container found, set up the selected folder
    await this.storage.updateSettings({ containerFolderId: folder.id, containerFolderName: folder.title });
    
    // Create both intermediate folders
    const newBookmarksFolder = await createBookmark(folder.id, BOOKMARK_FOLDERS.BOOKMARKS);
    await createBookmark(folder.id, BOOKMARK_FOLDERS.SNAPSHOTS);
    
    return newBookmarksFolder;
  }

  // Get the bookmarks folder (internal use)
  private async getTabGroupsFolderInternal(): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const folder = await this.getTabGroupsFolder();
    if (!folder) {
      throw new Error('Tab Groups bookmarks folder not found');
    }
    return folder;
  }

  async ensureGroupFolder(name: string): Promise<chrome.bookmarks.BookmarkTreeNode> {
    this.logger.info('ensureGroupFolder:start', { name });
    const bookmarksFolder = await this.getTabGroupsFolderInternal();
    
    // Check if we already have a folder for this group
    const mapping = await this.storage.getMapping(name);
    this.logger.debug('ensureGroupFolder:mapping', { name, mapping });

    if (mapping?.folderId) {
      const folder = await getBookmark(mapping.folderId);
      if (folder) {
        // Update folder name if it changed
        if (folder.title !== name) {
          await updateBookmark(folder.id, { title: name });
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
    const existingFolders = await getBookmarkChildren(bookmarksFolder.id);
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
    const folder = await createBookmark(bookmarksFolder.id, name);
    this.logger.info('groupFolder:created', {
      name,
      folderId: folder.id,
      parentId: bookmarksFolder.id
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
      // Get or create the Tab Group Bookmarks folder
      const bookmarksFolder = await this.getTabGroupsFolder();
      if (!bookmarksFolder) {
        throw new Error('Please select a location for your bookmarks first');
      }
      
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

      // Create bookmarks only for new tabs using promise-based API
      const results = await Promise.all(
        validTabs.map(async (tab) => {
          try {
            const result = await chrome.bookmarks.create({
              parentId: groupFolder.id,
              title: tab.title,
              url: tab.url
            });
            
            this.logger.debug('sync:bookmarkCreated', {
              bookmarkId: result.id,
              title: result.title,
              url: result.url
            });
            
            return result;
          } catch (error) {
            this.logger.error('sync:createBookmarkFailed', {
              url: tab.url,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
          }
        })
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
    const settings = await this.storage.getSettings();
    
    // Check if the deleted folder was our container
    if (id === settings.containerFolderId) {
      this.logger.info('containerFolder:deleted', {
        folderId: id,
        action: 'checking for tab groups'
      });

      // Check if any tab groups still exist
      const tabGroups = await new Promise<chrome.tabGroups.TabGroup[]>((resolve) => {
        chrome.tabGroups.query({}, resolve);
      });
      
      if (tabGroups.length > 0) {
        // Automatic recreation — use removeInfo since the folder is already deleted
        // Do NOT call createContainerFolder() here — it calls getBookmark on the
        // deleted folder ID which will fail. Use removeInfo for parent and title.
        this.logger.logDecision(
          'Recreating container folder',
          'Container folder was deleted but tab groups still exist',
          { 
            deletedFolderId: id, 
            existingGroupCount: tabGroups.length,
            groupNames: tabGroups.map(g => g.title || 'Untitled'),
            parentId: removeInfo.parentId,
            folderTitle: removeInfo.node.title
          }
        );
        
        try {
          const parentId = removeInfo.parentId;
          const title = removeInfo.node.title || 'Tab Groups';
          const newContainer = await createBookmark(parentId, title);
          await this.storage.updateSettings({ containerFolderId: newContainer.id, containerFolderName: newContainer.title });
          await this.setupTabGroupsFolder(newContainer);
          
          this.logger.info('containerFolder:recreated', {
            oldFolderId: id,
            newFolderId: newContainer.id,
            groupCount: tabGroups.length
          });
        } catch (error) {
          this.logger.error('containerFolder:recreationFailed', {
            error: error instanceof Error ? error.message : 'Unknown error',
            deletedFolderId: id
          });
        }
      } else {
        this.logger.logDecision(
          'Not recreating container folder',
          'Container folder was deleted and no tab groups exist',
          { deletedFolderId: id }
        );
      }
      
      return;
    }

    // Check if the deleted bookmark was a group folder
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
}
