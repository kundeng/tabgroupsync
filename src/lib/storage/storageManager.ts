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
  UngroupedTabsSettings
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

  private async saveState(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ state: this.persistedState }, resolve);
    });
  }

  private notify(type: StorageEvent['type'], data: StorageEvent['data']): void {
    chrome.storage.sync.set({ 
      lastEvent: { type, data, timestamp: Date.now() }
    });
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
      const result = await new Promise<{ state?: unknown }>(resolve => {
        chrome.storage.sync.get('state', resolve);
      });

      try {
        if (result.state) {
          const validatedState = validateStorageState(result.state);
          this.persistedState = this.migrateStateIfNeeded(validatedState);
          
          // Clean up inactive groups if enabled
          if (this.persistedState.settings.cleanup.enabled) {
            const now = Date.now();
            const threshold = this.persistedState.settings.cleanup.inactiveThreshold * 24 * 60 * 60 * 1000; // days to ms
            
            // Remove groups that haven't been seen in threshold days
            Object.entries(this.persistedState.syncPreferences).forEach(([name, pref]) => {
              if (pref.lastSynced && now - pref.lastSynced > threshold) {
                delete this.persistedState.syncPreferences[name];
                this.logger.info('cleanup:removed', { 
                  name, 
                  lastSynced: new Date(pref.lastSynced).toISOString(),
                  threshold: this.persistedState.settings.cleanup.inactiveThreshold
                });
              }
            });
            
            // Save cleaned state
            await this.saveState();
          }
          
          // Initialize runtime mappings from persisted preferences
          Object.entries(this.persistedState.syncPreferences).forEach(([name, pref]) => {
            this.runtimeState.mappings[name] = {
              name,
              folderId: '',  // Will be populated when folder is created
              syncEnabled: pref.syncEnabled,
              status: {
                lastSynced: pref.lastSynced ?? 0,
                inProgress: false
              }
            };
          });
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

  private async getTabGroupsFolder(): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    const settings = await this.getSettings();
    if (!settings.containerFolderId) return null;
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
      lastSynced: settings.lastSynced ?? 0
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

    this.runtimeState.mappings[name] = newMapping;
    this.persistedState.syncPreferences[name] = {
      syncEnabled: newMapping.syncEnabled,
      lastSynced: newMapping.status.lastSynced
    };

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

  // Ungrouped Tabs Operations
  async updateUngroupedSettings(settings: Partial<UngroupedTabsSettings>): Promise<void> {
    this.runtimeState.ungrouped = {
      ...this.runtimeState.ungrouped,
      ...settings
    };
    await this.saveState();
    this.notify('mapping-changed', {});
  }

  async getUngroupedSettings(): Promise<UngroupedTabsSettings> {
    return this.runtimeState.ungrouped;
  }

  // History Operations
  async addHistoryEntry(entry: SyncHistoryEntry): Promise<void> {
    return withErrorHandling(async () => {
      const validatedEntry = validateSyncHistoryEntry(entry);
      this.persistedState.syncHistory = [validatedEntry, ...this.persistedState.syncHistory].slice(0, 100);
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
    this.notify('settings-changed', this.persistedState);
  }

  private migrateStateIfNeeded(state: StorageState): StorageState {
    if (state.version === DEFAULT_STATE.version) return state;
    return {
      ...DEFAULT_STATE,
      ...state,
      version: DEFAULT_STATE.version
    };
  }
}
