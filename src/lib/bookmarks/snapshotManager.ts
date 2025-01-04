import { Logger, OperationTracker } from '../utils/logger';
import { StorageManager } from '../storage/storageManager';
import { createBookmark } from './bookmarkMutations';
import { getBookmark, getBookmarkChildren } from './bookmarkQueries';
import { BOOKMARK_FOLDERS } from '../constants';

export interface SnapshotMetadata {
  id: string;
  sourceId: string;
  sourceName: string;
  timestamp: number;
  description?: string;
}

export class SnapshotManager {
  private logger = Logger.getInstance();
  private tracker = OperationTracker.getInstance();
  private storage: StorageManager;
  private snapshotFolderId?: string;

  constructor(storage: StorageManager) {
    this.storage = storage;
  }

  private async findFolderByPath(parentId: string, name: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const children = await chrome.bookmarks.getChildren(parentId);
    return children.find(child => child.title === name && !child.url) || null;
  }

  private async ensureSnapshotFolder(): Promise<string> {
    if (this.snapshotFolderId) {
      const folder = await getBookmark(this.snapshotFolderId);
      if (folder && folder.title === BOOKMARK_FOLDERS.SNAPSHOTS) {
        return this.snapshotFolderId;
      }
    }

    // Get or create "Tab Group Snapshots" folder
    const settings = await this.storage.getSettings();
    if (!settings.containerFolderId) {
      throw new Error('Container folder not set');
    }

    const container = await getBookmark(settings.containerFolderId);
    if (!container) {
      throw new Error('Container folder not found');
    }

    // Try to find existing snapshots folder
    const existingFolder = await this.findFolderByPath(container.id, BOOKMARK_FOLDERS.SNAPSHOTS);
    if (existingFolder) {
      this.snapshotFolderId = existingFolder.id;
      return existingFolder.id;
    }

    // Create new snapshots folder
    const folder = await createBookmark(container.id, BOOKMARK_FOLDERS.SNAPSHOTS);
    this.snapshotFolderId = folder.id;
    return folder.id;
  }

  private async createSnapshotFolder(sourceName: string, timestamp: number): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const snapshotParentId = await this.ensureSnapshotFolder();
    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    const timeStr = new Date(timestamp).toLocaleTimeString();
    const folderName = `${sourceName} (${dateStr} ${timeStr})`;
    
    return createBookmark(snapshotParentId, folderName);
  }

  async createSnapshot(
    sourceId: string,
    sourceName: string,
    description?: string
  ): Promise<SnapshotMetadata> {
    const opId = this.tracker.startOperation('createSnapshot', { sourceId, sourceName });

    try {
      // Get source folder contents
      const sourceFolder = await getBookmark(sourceId);
      if (!sourceFolder) {
        throw new Error(`Source folder ${sourceId} not found`);
      }

      const sourceBookmarks = await getBookmarkChildren(sourceId);
      
      // Create snapshot folder
      const timestamp = Date.now();
      const snapshotFolder = await this.createSnapshotFolder(sourceName, timestamp);

      // Copy all bookmarks to snapshot folder
      await Promise.all(sourceBookmarks.map(bookmark => 
        createBookmark(snapshotFolder.id, bookmark.title, bookmark.url)
      ));

      const metadata: SnapshotMetadata = {
        id: snapshotFolder.id,
        sourceId,
        sourceName,
        timestamp,
        description
      };

      this.logger.info('snapshot:created', {
        sourceId,
        sourceName,
        snapshotId: snapshotFolder.id,
        bookmarkCount: sourceBookmarks.length
      });

      return metadata;
    } catch (error) {
      this.logger.error('snapshot:failed', {
        sourceId,
        sourceName,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
      throw error;
    } finally {
      this.tracker.endOperation(opId);
    }
  }

  async listSnapshots(sourceId?: string): Promise<SnapshotMetadata[]> {
    try {
      const snapshotParentId = await this.ensureSnapshotFolder();
      const snapshots = await getBookmarkChildren(snapshotParentId);
      
      // Parse snapshot folders to get metadata
      const snapshotMetadata = snapshots
        .filter(folder => !folder.url) // Only folders
        .map(folder => {
          const match = folder.title.match(/^(.*?) \((\d{4}-\d{2}-\d{2}) ([\d:]+(?:\s?[AP]M)?)\)$/);
          if (!match) return null;

          const [, name, date, time] = match;
          const timestamp = new Date(`${date} ${time}`).getTime();

          return {
            id: folder.id,
            sourceId: '', // We don't store this in the folder name
            sourceName: name,
            timestamp
          };
        })
        .filter((meta): meta is SnapshotMetadata => meta !== null);

      // Filter by sourceId if provided
      return sourceId 
        ? snapshotMetadata.filter(meta => meta.sourceId === sourceId)
        : snapshotMetadata;

    } catch (error) {
      this.logger.error('listSnapshots:failed', {
        sourceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    const opId = this.tracker.startOperation('deleteSnapshot', { snapshotId });

    try {
      const snapshot = await getBookmark(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }

      await chrome.bookmarks.removeTree(snapshotId);
      
      this.logger.info('snapshot:deleted', { snapshotId });
    } catch (error) {
      this.logger.error('deleteSnapshot:failed', {
        snapshotId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
      throw error;
    } finally {
      this.tracker.endOperation(opId);
    }
  }
}
