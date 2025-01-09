import {
  StorageState,
  DEFAULT_STATE,
  StorageEvent,
  SyncHistoryEntry,
  GlobalSettings,
  GroupSyncSettings,
  RuntimeState,
  RuntimeMapping,
  RuntimeMappingUpdate,
  CombinedState,
  GroupSyncPreferences
} from '../types/storage';
import { validateStorageState, validateSyncHistoryEntry } from '../utils/validators';
import { StorageError, withErrorHandling, ErrorType } from '../utils/errors';
import { Logger } from '../utils/logger';

export class StorageManager {
  private persistedState: StorageState;
  private runtimeState: RuntimeState;
  private logger = Logger.getInstance();

  constructor() {
    this.persistedState = DEFAULT_STATE;
    this.runtimeState = {
      mappings: {},
      groupSettings: {}
    };
  }

  private async saveState(): Promise<void> {
    // Save settings
    await new Promise<void>((resolve) => {
      chrome.storage.sync.set({ 'state:settings': this.persistedState.settings }, resolve);
    });

    // Save each group's preferences separately
    await Promise.all(
      Object.entries(this.persistedState.syncPreferences).map(([name, pref]) =>
        new Promise<void>((resolve) => {
          chrome.storage.sync.set({
            [`pref:${name}`]: {
              syncEnabled: pref.syncEnabled  // Only store essential data
            }
          }, resolve);
        })
      )
    );

    // Save limited history
    await new Promise<void>((resolve) => {
      chrome.storage.sync.set({
        'state:history': this.persistedState.syncHistory.slice(0, 10)
      }, resolve);
    });
  }

  private notify(type: StorageEvent['type'], data: StorageEvent['data']): void {
    // Just log events instead of storing them
    this.logger.info('storage:event', { type, data });
  }

  async initialize(): Promise<void> {
    try {
      await this.loadState();
      this.logger.info('storage:initialized', {
        settings: this.persistedState.settings,
        mappings: Object.keys(this.runtimeState.mappings).length
      });
    } catch (error) {
      this.logger.error('storage:initialize:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private async loadState(): Promise<void> {
    return withErrorHandling(async () => {
      // Load settings first
      const settings = await new Promise<{ 'state:settings'?: unknown }>(resolve => {
        chrome.storage.sync.get('state:settings', resolve);
      });

      try {
        if (settings['state:settings']) {
          // Get all preference keys
          const allKeys = await new Promise<{ [key: string]: any }>(resolve => {
            chrome.storage.sync.get(null, resolve);
          });

          // Extract group preferences
          const preferences: GroupSyncPreferences = {};
          for (const [key, value] of Object.entries(allKeys)) {
            if (key.startsWith('pref:')) {
              const name = key.slice(5); // Remove 'pref:' prefix
              preferences[name] = {
                syncEnabled: value.syncEnabled,
                lastSeen: Date.now(),  // Initialize lastSeen
                lastSynced: 0  // Initialize lastSynced
              };
            }
          }

          // Load history
          const history = await new Promise<{ 'state:history'?: SyncHistoryEntry[] }>(resolve => {
            chrome.storage.sync.get('state:history', resolve);
          });

          // Reconstruct state
          const state = {
            version: DEFAULT_STATE.version,
            settings: settings['state:settings'] as GlobalSettings,
            syncPreferences: preferences,
            syncHistory: history['state:history'] || []
          };
          const validatedState = validateStorageState(state);
          this.persistedState = await this.migrateStateIfNeeded(validatedState);
          
          // Clean up inactive groups and verify folder structure
          await this.performMaintenance();
          
          // Initialize runtime mappings from persisted preferences
          await this.initializeRuntimeMappings();
        } else {
          this.persistedState = DEFAULT_STATE;
          await this.saveState();
        }
      } catch (error) {
        this.persistedState = DEFAULT_STATE;
        await this.saveState();
        throw new StorageError('Failed to validate stored state, reset to default', error);
      }
    }, ErrorType.STORAGE);
  }

  private async performMaintenance(): Promise<void> {
    // Clean up inactive groups if enabled
    if (this.persistedState.settings.cleanup.enabled) {
      const now = Date.now();
      const threshold = this.persistedState.settings.cleanup.inactiveThreshold * 24 * 60 * 60 * 1000; // days to ms
      
      // Remove groups that haven't been seen in threshold days
      Object.entries(this.persistedState.syncPreferences).forEach(([name, pref]) => {
        if (pref.lastSeen && now - pref.lastSeen > threshold) {
          delete this.persistedState.syncPreferences[name];
          this.logger.info('cleanup:removed', { 
            name, 
            lastSeen: new Date(pref.lastSeen).toISOString(),
            threshold: this.persistedState.settings.cleanup.inactiveThreshold
          });
        }
      });
    }

    // Verify container folder still exists
    if (this.persistedState.settings.containerFolderId) {
      try {
        const folder = await new Promise<chrome.bookmarks.BookmarkTreeNode[]>((resolve) => {
          chrome.bookmarks.get(this.persistedState.settings.containerFolderId!, resolve);
        });
        
        if (!folder || folder.length === 0) {
          // Container folder was deleted, clear the ID and disable sync for all groups
          this.persistedState.settings.containerFolderId = undefined;
          
          // Update all runtime mappings to show error but preserve sync state
          Object.keys(this.runtimeState.mappings).forEach(name => {
            const mapping = this.runtimeState.mappings[name];
            this.runtimeState.mappings[name] = {
              ...mapping,
              status: {
                ...mapping.status,
                inProgress: false,
                error: 'Backup location not found'
              }
            };
          });

          this.logger.warn('maintenance:containerFolderMissing', {
            action: 'cleared container folder ID and disabled sync for all groups'
          });

          // Add history entry for the container removal
          await this.addHistoryEntry({
            timestamp: Date.now(),
            type: 'group-to-folder',
            folderId: this.persistedState.settings.containerFolderId!,
            success: false,
            error: 'Backup location not found'
          });
        }
      } catch (error) {
        // Handle error by clearing the container folder ID and disabling sync
        this.persistedState.settings.containerFolderId = undefined;
        
        // Update all runtime mappings to reflect error state
        Object.keys(this.runtimeState.mappings).forEach(name => {
          this.runtimeState.mappings[name] = {
            ...this.runtimeState.mappings[name],
            syncEnabled: false,
            status: {
              lastSynced: Date.now(),
              inProgress: false,
              error: 'Failed to verify backup location'
            }
          };
          
          // Update persisted preferences
          if (this.persistedState.syncPreferences[name]) {
            this.persistedState.syncPreferences[name].syncEnabled = false;
          }
        });

        this.logger.error('maintenance:containerFolderCheckFailed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          action: 'disabled sync for all groups'
        });
      }
    }

    // Save cleaned state
    await this.saveState();
  }

  private async initializeRuntimeMappings(): Promise<void> {
    // Initialize runtime mappings from persisted preferences
    const containerFolder = await this.getTabGroupsFolder();
    
    // If container folder is missing, show error but preserve sync state
    if (!containerFolder) {
      Object.entries(this.persistedState.syncPreferences).forEach(([name, pref]) => {
        this.runtimeState.mappings[name] = {
          name,
          folderId: '',
          syncEnabled: pref.syncEnabled, // Keep sync state
          status: {
            lastSynced: pref.lastSynced ?? 0,
            inProgress: false,
            error: 'Please select a location for your bookmarks'
          }
        };
      });
      return;
    }

    // Initialize mappings with proper folder IDs
    for (const [name, pref] of Object.entries(this.persistedState.syncPreferences)) {
      try {
        // Try to find existing folder for this group
        const groupFolders = await new Promise<chrome.bookmarks.BookmarkTreeNode[]>((resolve) => {
          chrome.bookmarks.getChildren(containerFolder.id, resolve);
        });
        const groupFolder = groupFolders.find(f => f.title === name);
        
        this.runtimeState.mappings[name] = {
          name,
          folderId: groupFolder?.id || '', // Use existing folder ID if found
          // Keep user's sync preference, folder will be recreated when needed
          syncEnabled: pref.syncEnabled,
          status: {
            lastSynced: pref.lastSynced ?? 0,
            inProgress: false
          }
        };
      } catch (error) {
        this.logger.error('initializeRuntimeMappings:failed', {
          name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        // Handle initialization error for this mapping
        this.runtimeState.mappings[name] = {
          name,
          folderId: '',
          syncEnabled: false,
          status: {
            lastSynced: pref.lastSynced ?? 0,
            inProgress: false,
            error: 'Failed to initialize backup'
          }
        };
      }
    }
  }

  private async getTabGroupsFolder(): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const settings = await this.getSettings();
    if (!settings.containerFolderId) return null;
    
    try {
      const results = await new Promise<chrome.bookmarks.BookmarkTreeNode[]>((resolve) => {
        chrome.bookmarks.get(settings.containerFolderId!, resolve);
      });
      
      if (!results || results.length === 0) {
        // Container folder was deleted, clear the ID
        await this.updateSettings({ containerFolderId: undefined });
        return null;
      }
      
      return results[0];
    } catch (error) {
      this.logger.error('getTabGroupsFolder:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Clear invalid container folder ID
      await this.updateSettings({ containerFolderId: undefined });
      return null;
    }
  }

  // Settings Operations
  async updateSettings(settings: Partial<GlobalSettings>): Promise<void> {
    this.persistedState.settings = { ...this.persistedState.settings, ...settings };
    await this.saveState();
    this.notify('settings-changed', { settings: this.persistedState.settings });
  }

  async getSettings(): Promise<GlobalSettings> {
    return this.persistedState.settings;
  }

  // Group Operations
  async updateGroupSyncSettings(name: string, settings: GroupSyncSettings): Promise<void> {
    this.persistedState.syncPreferences[name] = {
      syncEnabled: settings.enabled,
      lastSynced: settings.lastSynced ?? 0,
      lastSeen: Date.now()  // Initialize lastSeen when creating preferences
    };
    await this.saveState();
    this.notify('mapping-changed', {});
  }

  async getGroupSyncSettings(name: string): Promise<GroupSyncSettings> {
    const persisted = this.persistedState.syncPreferences[name];
    return {
      enabled: persisted?.syncEnabled ?? false,
      lastSynced: persisted?.lastSynced ?? 0
    };
  }

  async updateMapping(name: string, update: RuntimeMappingUpdate): Promise<void> {
    const persisted = this.persistedState.syncPreferences[name];
    const current = this.runtimeState.mappings[name] || {
      name,
      folderId: '',
      syncEnabled: persisted?.syncEnabled ?? false,
      status: {
        lastSynced: persisted?.lastSynced ?? 0,
        inProgress: false
      }
    };

    const newMapping = {
      ...current,
      ...update,
      status: update.status ? { ...current.status, ...update.status } : current.status
    };

    // Update runtime state
    this.runtimeState.mappings[name] = newMapping;

    // Only update persisted sync preference if explicitly changed
    if (update.syncEnabled !== undefined) {
      this.persistedState.syncPreferences[name] = {
        syncEnabled: update.syncEnabled, // Use the explicit update value
        lastSynced: newMapping.status.lastSynced,
        lastSeen: Date.now()
      };
    } else if (this.persistedState.syncPreferences[name]) {
      // Just update timestamps if preference exists
      this.persistedState.syncPreferences[name].lastSynced = newMapping.status.lastSynced;
      this.persistedState.syncPreferences[name].lastSeen = Date.now();
    }

    await this.saveState();
    this.notify('mapping-changed', {});
  }

  async removeMapping(name: string): Promise<void> {
    delete this.runtimeState.mappings[name];
    delete this.persistedState.syncPreferences[name];
    await this.saveState();
    this.notify('mapping-changed', {});
  }

  async getMapping(name: string): Promise<RuntimeMapping | undefined> {
    return this.runtimeState.mappings[name];
  }

  async getAllMappings(): Promise<Record<string, RuntimeMapping>> {
    return this.runtimeState.mappings;
  }

  // History Operations
  async addHistoryEntry(entry: SyncHistoryEntry): Promise<void> {
    return withErrorHandling(async () => {
      const validatedEntry = validateSyncHistoryEntry(entry);
      // Keep limited history
      this.persistedState.syncHistory = [validatedEntry, ...this.persistedState.syncHistory].slice(0, 10);
      await this.saveState();
      this.notify('history-added', { syncHistory: this.persistedState.syncHistory });
    }, ErrorType.STORAGE);
  }

  async getHistory(): Promise<SyncHistoryEntry[]> {
    return this.persistedState.syncHistory;
  }

  // State Operations
  async getState(): Promise<CombinedState> {
    return {
      ...this.persistedState,
      runtime: this.runtimeState
    };
  }

  async clearAllData(): Promise<void> {
    this.persistedState = DEFAULT_STATE;
    this.runtimeState = {
      mappings: {},
      groupSettings: {}
    };
    await this.saveState();
    this.notify('settings-changed', this.persistedState);
  }

  private async migrateStateIfNeeded(state: StorageState): Promise<StorageState> {
    if (state.version === DEFAULT_STATE.version) return state;

    // Migrate from v1 (monolithic) to v2 (chunked)
    if (state.version === 1) {
      try {
        // Save settings chunk
        await new Promise<void>((resolve) => {
          chrome.storage.sync.set({ 'state:settings': state.settings }, resolve);
        });

        // Save each group's preferences separately
        await Promise.all(
          Object.entries(state.syncPreferences).map(([name, pref]) =>
            new Promise<void>((resolve) => {
              chrome.storage.sync.set({
                [`pref:${name}`]: {
                  syncEnabled: pref.syncEnabled
                }
              }, resolve);
            })
          )
        );

        // Save limited history
        await new Promise<void>((resolve) => {
          chrome.storage.sync.set({
            'state:history': state.syncHistory.slice(0, 10)
          }, resolve);
        });

        // Remove old monolithic state
        await new Promise<void>((resolve) => {
          chrome.storage.sync.remove('state', resolve);
        });

        this.logger.info('storage:migrated', {
          fromVersion: 1,
          toVersion: 2,
          preferences: Object.keys(state.syncPreferences).length
        });

        // Return migrated state
        return {
          version: 2,
          settings: {
            ...state.settings,
            syncInterval: Math.max(state.settings.syncInterval || 5, 5) // Enforce 5 min minimum
          },
          syncPreferences: state.syncPreferences,
          syncHistory: state.syncHistory.slice(0, 10)
        };
      } catch (error) {
        this.logger.error('storage:migrationFailed', {
          fromVersion: 1,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // On error, return fresh v2 state
        return DEFAULT_STATE;
      }
    }

    // For unknown versions, return fresh state
    this.logger.warn('storage:unknownVersion', {
      version: state.version,
      action: 'reset to default'
    });
    return DEFAULT_STATE;
  }
}
