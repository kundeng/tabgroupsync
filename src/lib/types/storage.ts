// Unique identifiers
export type TabGroupId = string;
export type BookmarkFolderId = string;
export type WindowId = number;

// Group state
export interface GroupState {
  id: TabGroupId;
  name: string;
  color?: string;
  windowId?: number;
  lastSeen: number;
  folderId?: BookmarkFolderId;
  syncEnabled: boolean;
  status: SyncStatus;
  archived: boolean;  // For cleanup/archive feature
}

// Sync status and history
export interface SyncStatus {
  lastSynced: number;
  error?: string;
  inProgress: boolean;
}

// Group sync settings
export interface GroupSyncSettings {
  enabled: boolean;
  folderId?: BookmarkFolderId;
  lastSynced?: number;
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
  type: 'group-to-folder' | 'folder-to-group' | 'ungrouped' | 'archived';
  groupId?: TabGroupId;
  folderId: BookmarkFolderId;
  success: boolean;
  error?: string;
}

// Cleanup settings
export interface CleanupSettings {
  enabled: boolean;
  inactiveThreshold: number;  // Days before considering a group inactive
  autoArchive: boolean;       // Automatically archive inactive groups
  deleteThreshold: number;    // Days before allowing deletion of archived groups
}

// Global settings
export interface GlobalSettings {
  autoSync: boolean;
  parentFolderId?: BookmarkFolderId;
  syncInterval?: number; // in minutes
  keepRemoved: boolean; // keep bookmarks when group is removed
  syncUngrouped: boolean;
  cleanup: CleanupSettings;
}

// Complete storage state
export interface StorageState {
  version: number; // For future migrations
  settings: GlobalSettings;
  groups: Record<TabGroupId, GroupState>;  // All known groups
  groupSettings: Record<TabGroupId, GroupSyncSettings>; // Per-group sync settings
  mappings: Record<TabGroupId, GroupFolderMapping>;
  ungroupedTabs: UngroupedTabsSettings;
  syncHistory: SyncHistoryEntry[];
}

// Default cleanup settings
const DEFAULT_CLEANUP_SETTINGS: CleanupSettings = {
  enabled: true,
  inactiveThreshold: 30,  // 30 days
  autoArchive: true,
  deleteThreshold: 90     // 90 days
};

// Default state
export const DEFAULT_STATE: StorageState = {
  version: 1,
  settings: {
    autoSync: false,
    keepRemoved: true,
    syncUngrouped: false,
    cleanup: DEFAULT_CLEANUP_SETTINGS
  },
  groups: {},
  groupSettings: {},
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
  | 'history-added'
  | 'group-archived'
  | 'group-restored'
  | 'group-deleted';

export interface StorageEvent {
  type: StorageEventType;
  data: Partial<StorageState>;
}

export type StorageEventCallback = (event: StorageEvent) => void;

// View model for UI
export interface GroupViewModel {
  id: TabGroupId;
  name: string;
  color?: string;
  windowId?: number;
  isCurrentWindow: boolean;
  isActive: boolean;
  isArchived: boolean;
  lastSeen: number;
  syncEnabled: boolean;
  status: SyncStatus;
  folder?: chrome.bookmarks.BookmarkTreeNode;
  inactiveFor?: number;  // Days inactive
}
