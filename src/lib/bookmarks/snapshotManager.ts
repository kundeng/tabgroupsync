import { Logger, OperationTracker } from '../utils/logger';
import { StorageManager } from '../storage/storageManager';
import { BookmarkManager } from './bookmarkManager';
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

  constructor(
    private readonly storage: StorageManager,
    private readonly bookmarkManager: BookmarkManager
  ) {}

  private async migrateOldSnapshots(parentId: string): Promise<void> {
    try {
      const snapshots = await getBookmarkChildren(parentId);
      const mappings = await this.storage.getAllMappings();
      
      for (const snapshot of snapshots) {
        if (snapshot.url) continue; // Skip non-folders
        
        // Check if it's in old format
        const oldFormatMatch = snapshot.title.match(/^(.*?) \((\d{4}-\d{2}-\d{2}) ([\d:]+(?:\s?[AP]M)?)\)$/);
        if (!oldFormatMatch) continue;

        const [, groupName, date, time] = oldFormatMatch;
        const timestamp = new Date(`${date} ${time}`).getTime();
        if (isNaN(timestamp)) continue;

        // Find the group's folder ID from mappings
        const mapping = Object.values(mappings).find(m => m.name === groupName);
        if (!mapping || !mapping.folderId) {
          this.logger.warn('snapshot:migration:noMapping', {
            groupName,
            snapshotId: snapshot.id
          });
          continue;
        }

        // Rename to new format
        const dateStr = new Date(timestamp).toISOString().split('T')[0];
        const timeStr = new Date(timestamp).toTimeString().split(' ')[0];
        const newTitle = `${groupName}|${mapping.folderId}|${dateStr} ${timeStr}`;
        
        await chrome.bookmarks.update(snapshot.id, { title: newTitle });
        this.logger.info('snapshot:migrated', { 
          id: snapshot.id,
          oldTitle: snapshot.title,
          newTitle,
          groupName,
          groupId: mapping.folderId
        });
      }
    } catch (error) {
      this.logger.error('snapshot:migration:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - migration failure shouldn't block normal operation
    }
  }

  private async findFolderByPath(parentId: string, name: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const children = await chrome.bookmarks.getChildren(parentId);
    return children.find(child => child.title === name && !child.url) || null;
  }

  private async ensureSnapshotFolder(): Promise<string> {
    // Get container folder (abc)
    const container = await this.bookmarkManager.getContainerFolder();
    if (!container) {
      throw new Error('Please select a location for your bookmarks first');
    }

    // Try to find existing snapshots folder
    const existingFolder = await this.findFolderByPath(container.id, BOOKMARK_FOLDERS.SNAPSHOTS);
    if (existingFolder) {
      return existingFolder.id;
    }

    // Create new snapshots folder
    const folder = await createBookmark(container.id, BOOKMARK_FOLDERS.SNAPSHOTS);

    // Migrate any existing snapshots in old format
    await this.migrateOldSnapshots(folder.id);

    return folder.id;
  }

  private async createSnapshotFolder(
    sourceName: string, 
    sourceId: string,
    timestamp: number
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const snapshotParentId = await this.ensureSnapshotFolder();
    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    const timeStr = new Date(timestamp).toTimeString().split(' ')[0]; // Use 24-hour format
    const folderName = `${sourceName}|${sourceId}|${dateStr} ${timeStr}`; // Include sourceId in name
    
    return createBookmark(snapshotParentId, folderName);
  }

  async createSnapshot(
    sourceId: string,
    sourceName: string,
    description?: string
  ): Promise<SnapshotMetadata> {
    const opId = this.tracker.startOperation('createSnapshot', { sourceId, sourceName });

    try {
      // Get current tab group
      const groups = await chrome.tabGroups.query({});
      const group = groups.find(g => g.title === sourceName);
      if (!group) {
        throw new Error('Tab group not found');
      }

      // Get tabs in the group
      const tabs = await chrome.tabs.query({ groupId: group.id });
      if (tabs.length === 0) {
        throw new Error('No tabs to snapshot');
      }
      
      // Create snapshot folder
      const timestamp = Date.now();
      const snapshotFolder = await this.createSnapshotFolder(sourceName, sourceId, timestamp);

      // Copy all tabs to snapshot folder
      await Promise.all(tabs.map(tab => 
        createBookmark(snapshotFolder.id, tab.title || 'Untitled', tab.url || '')
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
        bookmarkCount: tabs.length
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
          const parts = folder.title.split('|');
          if (parts.length !== 3) return null;

          const [name, sid, datetime] = parts;
          const timestamp = new Date(datetime).getTime();

          return {
            id: folder.id,
            sourceId: sid,
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
