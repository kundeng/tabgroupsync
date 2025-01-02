// Unique identifiers
// All IDs are stored as strings for consistency
export type TabGroupId = string;
export type BookmarkFolderId = string;
export type WindowId = number;

// Sync status and history
export interface SyncStatus {
  lastSynced: number;
  error?: string;
  inProgress: boolean;
}

// Mapping between tab groups and folders
export interface GroupFolderMapping {
  groupId: TabGroupId;
  folderId: BookmarkFolderId;
  name: string;
  color?: string;
  syncEnabled: boolean;
  status: SyncStatus;
}

// Settings for ungrouped tabs
export interface UngroupedTabsSettings {
  enabled: boolean;
  folderId?: BookmarkFolderId;
  folderName: string;
  syncEnabled: boolean;
  status: SyncStatus;
}

// Sync history entry
export interface SyncHistoryEntry {
  timestamp: number;
  type: 'group-to-folder' | 'folder-to-group' | 'ungrouped';
  groupId?: TabGroupId;
  folderId: BookmarkFolderId;
  success: boolean;
  error?: string;
}

// Global settings
export interface GlobalSettings {
  autoSync: boolean;
  parentFolderId?: BookmarkFolderId;
  syncInterval?: number; // in minutes
  keepRemoved: boolean; // keep bookmarks when group is removed
  syncUngrouped: boolean;
}

// Complete storage state
export interface StorageState {
  version: number; // For future migrations
  settings: GlobalSettings;
  mappings: Record<TabGroupId, GroupFolderMapping>;
  ungroupedTabs: UngroupedTabsSettings;
  syncHistory: SyncHistoryEntry[];
}

// Default state
export const DEFAULT_STATE: StorageState = {
  version: 1,
  settings: {
    autoSync: true,
    keepRemoved: true,
    syncUngrouped: false
  },
  mappings: {},
  ungroupedTabs: {
    enabled: false,
    folderName: 'Ungrouped Tabs',
    syncEnabled: false,
    status: {
      lastSynced: 0,
      inProgress: false
    }
  },
  syncHistory: []
};

// Storage events for observers
export type StorageEventType = 
  | 'settings-changed'
  | 'mapping-added'
  | 'mapping-removed'
  | 'mapping-updated'
  | 'sync-status-changed'
  | 'history-added';

export interface StorageEvent {
  type: StorageEventType;
  data: Partial<StorageState>;
}

export type StorageEventCallback = (event: StorageEvent) => void;
