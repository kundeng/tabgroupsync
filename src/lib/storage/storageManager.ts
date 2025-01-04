import {
  StorageState,
  DEFAULT_STATE,
  StorageEvent,
  StorageEventCallback,
  SyncHistoryEntry,
  GlobalSettings,
  GroupSyncSettings,
  RuntimeState,
  RuntimeMapping,
  RuntimeMappingUpdate,
  CombinedState,
  UngroupedTabsSettings
} from '../types/storage';
import { validateStorageState, validateRuntimeMapping, validateSyncHistoryEntry } from '../utils/validators';
import { StorageError, withErrorHandling, ErrorType } from '../utils/errors';
import { Logger } from '../utils/logger';

export class StorageManager {
  private persistedState: StorageState;
  private runtimeState: RuntimeState;

  constructor() {
    // Initialize with default states
    this.persistedState = DEFAULT_STATE;
    this.runtimeState = {
      mappings: {},
      groupSettings: {},
      ungrouped: {
        enabled: false,
        folderName: 'Ungrouped Tabs',
        syncEnabled: false,
        status: {
          lastSynced: 0,
          inProgress: false
        }
      }
    };
  }

  // Initialize storage
  async initialize(): Promise<void> {
    try {
      // Load and validate state
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

  // Public method to reload state (e.g., when popup opens)
  async reloadState(): Promise<CombinedState> {
    try {
      await this.loadState();
      return {
        ...this.persistedState,
        runtime: this.runtimeState
      };
    } catch (error) {
      this.logger.error('storage:reloadState:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private logger = Logger.getInstance();

  private async getTabGroupsFolder(): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const settings = await this.getSettings();
    if (!settings.containerFolderId) {
      return null;
    }
    return new Promise<chrome.bookmarks.BookmarkTreeNode | null>((resolve) => {
      chrome.bookmarks.get(settings.containerFolderId, (results) => {
        if (chrome.runtime.lastError || !results || results.length === 0) {
          resolve(null);
        } else {
          resolve(results[0]);
        }
      });
    });
  }

  // Persisted State Management
  async loadState(): Promise<void> {
    return withErrorHandling(async () => {
      const result = await new Promise<{ state?: unknown }>(resolve => {
        chrome.storage.sync.get('state', resolve);
      });

      try {
        if (result.state) {
          const validatedState = validateStorageState(result.state);
          this.persistedState = this.migrateStateIfNeeded(validatedState);
          
          // Initialize runtime mappings from persisted preferences
          const tabGroupsFolder = await this.getTabGroupsFolder();
          if (tabGroupsFolder) {
            const folders = await chrome.bookmarks.getChildren(tabGroupsFolder.id);
            
            Object.entries(this.persistedState.syncPreferences).forEach(([name, pref]) => {
              // Find matching folder
              const folder = folders.find(f => f.title === name);
              
              this.runtimeState.mappings[name] = {
                name,
                folderId: folder?.id ?? '',  // Use existing folder ID if found
                syncEnabled: pref.syncEnabled,
                status: {
                  lastSynced: pref.lastSynced ?? 0,
                  inProgress: false
                }
              };
            });
          }

          this.logger.info('storage:loaded', {
            syncPreferences: this.persistedState.syncPreferences,
            runtimeMappings: this.runtimeState.mappings
          });
        } else {
          this.persistedState = DEFAULT_STATE;
          await this.saveState();
          this.logger.info('storage:initialized', {
            state: 'default'
          });
        }
      } catch (error) {
        this.persistedState = DEFAULT_STATE;
        await this.saveState();
        throw new StorageError('Failed to validate stored state, reset to default', error);
      }
    }, ErrorType.STORAGE);
  }

  private async saveState(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ state: this.persistedState }, resolve);
    });
  }

  // Ungrouped Tabs Management
  async getUngroupedSettings(): Promise<UngroupedTabsSettings> {
    return this.runtimeState.ungrouped;
  }

  async updateUngroupedSettings(settings: Partial<UngroupedTabsSettings>): Promise<void> {
    this.runtimeState.ungrouped = {
      ...this.runtimeState.ungrouped,
      ...settings
    };
    this.notify({
      type: 'mapping-changed',
      data: {}
    });
  }

  // Runtime Mapping Management
  async getMapping(name: string): Promise<RuntimeMapping | undefined> {
    return this.runtimeState.mappings[name];
  }

  async getAllMappings(): Promise<Record<string, RuntimeMapping>> {
    return this.runtimeState.mappings;
  }

  async updateMapping(name: string, update: RuntimeMappingUpdate): Promise<void> {
    const persisted = this.persistedState.syncPreferences[name];
    this.logger.debug('mapping:update:start', {
      name,
      update,
      persisted
    });

    const current = this.runtimeState.mappings[name] || {
      name,
      folderId: '',
      syncEnabled: persisted?.syncEnabled ?? false,
      status: {
        lastSynced: persisted?.lastSynced ?? 0,
        inProgress: false
      }
    };

    // Handle status updates specially to allow partial updates
    const status = update.status ? {
      ...current.status,
      ...update.status
    } : current.status;

    const newMapping = {
      ...current,
      ...update,
      status
    };

    this.runtimeState.mappings[name] = newMapping;

    // Always update persisted preferences to match runtime state
    this.persistedState.syncPreferences[name] = {
      syncEnabled: newMapping.syncEnabled,
      lastSynced: newMapping.status.lastSynced
    };
    await this.saveState();

    this.logger.info('mapping:updated', {
      name,
      mapping: newMapping,
      preferences: this.persistedState.syncPreferences[name]
    });

    this.notify({
      type: 'mapping-changed',
      data: {}
    });
  }

  async removeMapping(name: string): Promise<void> {
    delete this.runtimeState.mappings[name];
    delete this.persistedState.syncPreferences[name];
    await this.saveState();
    this.notify({
      type: 'mapping-changed',
      data: {}
    });
  }

  async getGroupSyncSettings(name: string): Promise<GroupSyncSettings> {
    const persisted = this.persistedState.syncPreferences[name];
    return {
      enabled: persisted?.syncEnabled ?? false,
      lastSynced: persisted?.lastSynced ?? 0
    };
  }

  async updateGroupSyncSettings(name: string, settings: GroupSyncSettings): Promise<void> {
    this.persistedState.syncPreferences[name] = {
      syncEnabled: settings.enabled,
      lastSynced: settings.lastSynced ?? 0
    };
    await this.saveState();
    this.notify({
      type: 'mapping-changed',
      data: {}
    });
  }

  private migrateStateIfNeeded(state: StorageState): StorageState {
    if (state.version === DEFAULT_STATE.version) {
      return state;
    }
    
    // Handle migrations here when version changes
    return {
      ...DEFAULT_STATE,
      ...state,
      version: DEFAULT_STATE.version
    };
  }

  private notify(event: StorageEvent): void {
    // Use chrome.storage.onChanged instead of custom observers
    chrome.storage.sync.set({ 
      lastEvent: { 
        type: event.type, 
        data: event.data,
        timestamp: Date.now() 
      } 
    });
  }

  // Combined State Access
  async getState(): Promise<CombinedState> {
    await this.reloadState(); // Ensure fresh state when popup opens
    return {
      ...this.persistedState,
      runtime: this.runtimeState
    };
  }

  // Settings Management
  async getSettings(): Promise<GlobalSettings> {
    return this.persistedState.settings;
  }

  async updateSettings(settings: Partial<GlobalSettings>): Promise<void> {
    this.persistedState.settings = { ...this.persistedState.settings, ...settings };
    await this.saveState();
    this.notify({
      type: 'settings-changed',
      data: { settings: this.persistedState.settings }
    });
  }

  // History Management
  async addHistoryEntry(entry: SyncHistoryEntry): Promise<void> {
    return withErrorHandling(async () => {
      const validatedEntry = validateSyncHistoryEntry(entry);
      this.persistedState.syncHistory = [validatedEntry, ...this.persistedState.syncHistory].slice(0, 100);
      await this.saveState();
      this.notify({
        type: 'history-added',
        data: { syncHistory: this.persistedState.syncHistory }
      });
    }, ErrorType.STORAGE);
  }

  async getHistory(): Promise<SyncHistoryEntry[]> {
    await this.loadState();
    return this.persistedState.syncHistory;
  }

  // Utility Methods
  async clearAllData(): Promise<void> {
    this.persistedState = DEFAULT_STATE;
    this.runtimeState = {
      mappings: {},
      groupSettings: {},
      ungrouped: {
        enabled: false,
        folderName: 'Ungrouped Tabs',
        syncEnabled: false,
        status: {
          lastSynced: 0,
          inProgress: false
        }
      }
    };
    await this.saveState();
    this.notify({
      type: 'settings-changed',
      data: this.persistedState
    });
  }

  async exportData(): Promise<string> {
    await this.loadState();
    return JSON.stringify({
      ...this.persistedState,
      runtime: this.runtimeState
    }, null, 2);
  }

  async importData(jsonData: string): Promise<void> {
    return withErrorHandling(async () => {
      try {
        const parsed = JSON.parse(jsonData);
        const validatedState = validateStorageState(parsed);
        this.persistedState = this.migrateStateIfNeeded(validatedState);
        if (parsed.runtime) {
          this.runtimeState = parsed.runtime;
        }
        await this.saveState();
        this.notify({
          type: 'settings-changed',
          data: this.persistedState
        });
      } catch (error) {
        throw new StorageError('Invalid import data', error);
      }
    }, ErrorType.STORAGE);
  }
}
