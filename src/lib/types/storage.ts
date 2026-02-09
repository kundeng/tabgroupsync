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

// Sync history entry
export interface SyncHistoryEntry {
  timestamp: number;
  type: 'group-to-folder' | 'folder-to-group' | 'archived';
  groupId?: TabGroupId;
  folderId?: BookmarkFolderId;  // Optional for error cases
  success: boolean;
  error?: string;
  details?: string;  // Additional context for the entry
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
  containerFolderId?: BookmarkFolderId;  // Stable across sessions and synced across devices
  syncInterval?: number; // in minutes
  keepRemoved: boolean; // keep bookmarks when group is removed
  cleanup: CleanupSettings;
}

// Runtime mapping for current session
export interface RuntimeMapping {
  name: string;  // Group name (stable identifier)
  folderId: BookmarkFolderId;
  currentGroupId?: TabGroupId;  // Current session's Chrome group ID
  color?: string;
  syncEnabled: boolean;
  status: SyncStatus;
}

// Runtime state (not persisted)
export interface RuntimeState {
  mappings: Record<string, RuntimeMapping>;  // Keyed by group name
  groupSettings: Record<string, GroupSyncSettings>;
}

// Partial mapping updates
export interface RuntimeMappingUpdate {
  name?: string;
  folderId?: BookmarkFolderId;
  currentGroupId?: TabGroupId;
  color?: string;
  syncEnabled?: boolean;
  status?: Partial<SyncStatus>;
  userAction?: boolean;  // Whether this update was triggered by user action
}

// Persisted sync preferences for groups
export interface GroupSyncPreferences {
  [name: string]: {
    syncEnabled: boolean;
    userSet?: boolean;    // Whether user has explicitly set this preference
    lastSynced?: number;  // Runtime only
    lastSeen?: number;    // Runtime only
  };
}

// Persisted storage state
export interface StorageState {
  version: number;
  settings: GlobalSettings;
  syncHistory: SyncHistoryEntry[];
  syncPreferences: GroupSyncPreferences;  // Persist sync preferences by group name
}

// Combined state
export interface CombinedState extends StorageState {
  runtime: RuntimeState;
}

// Default state
export const DEFAULT_STATE: StorageState = {
  version: 2, // Current storage format version
  settings: {
    autoSync: false,
    keepRemoved: true,
    syncInterval: 5, // 5 minute minimum to avoid quota issues
    cleanup: {
      enabled: true,
      inactiveThreshold: 30,  // 30 days
      autoArchive: true,
      deleteThreshold: 90     // 90 days
    }
  },
  syncHistory: [],
  syncPreferences: Object.create(null)  // Start with empty preferences, avoid prototype pollution
};

// Storage events for observers
export type StorageEventType = 
  | 'settings-changed'
  | 'mapping-changed'  // When runtime mappings change
  | 'history-added';

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
  lastSeen: number;
  syncEnabled: boolean;
  status: SyncStatus;
  folder?: chrome.bookmarks.BookmarkTreeNode;
  inactiveFor?: number;  // Days inactive
}
