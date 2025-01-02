import {
  StorageState,
  DEFAULT_STATE,
  StorageEvent,
  StorageEventCallback,
  GroupFolderMapping,
  SyncHistoryEntry,
  TabGroupId,
  BookmarkFolderId,
  GlobalSettings
} from '../types/storage';
import { validateStorageState, validateGroupFolderMapping, validateSyncHistoryEntry } from '../utils/validators';
import { StorageError, withErrorHandling, ErrorType } from '../utils/errors';

export class StorageManager {
  private observers: Set<StorageEventCallback> = new Set();
  private state: StorageState = DEFAULT_STATE;

  constructor() {
    this.loadState();
  }

  // State Management
  async loadState(): Promise<void> {
    return withErrorHandling(async () => {
      const result = await new Promise<{ state?: unknown }>(resolve => {
        chrome.storage.sync.get('state', resolve);
      });

      if (result.state) {
        try {
          const validatedState = validateStorageState(result.state);
          this.state = this.migrateStateIfNeeded(validatedState);
        } catch (error) {
          throw new StorageError('Failed to validate stored state', error);
        }
      }
    }, ErrorType.STORAGE);
  }

  private async saveState(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ state: this.state }, resolve);
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

  // Event System
  subscribe(callback: StorageEventCallback): () => void {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  private notify(event: StorageEvent): void {
    this.observers.forEach(callback => callback(event));
  }

  // Settings Management
  async getSettings(): Promise<GlobalSettings> {
    await this.loadState();
    return this.state.settings;
  }

  async updateSettings(settings: Partial<GlobalSettings>): Promise<void> {
    this.state.settings = { ...this.state.settings, ...settings };
    await this.saveState();
    this.notify({
      type: 'settings-changed',
      data: { settings: this.state.settings }
    });
  }

  // Group-Folder Mapping Management
  async getMapping(groupId: TabGroupId): Promise<GroupFolderMapping | undefined> {
    await this.loadState();
    return this.state.mappings[groupId];
  }

  async getAllMappings(): Promise<Record<TabGroupId, GroupFolderMapping>> {
    await this.loadState();
    return this.state.mappings;
  }

  async addMapping(mapping: GroupFolderMapping): Promise<void> {
    return withErrorHandling(async () => {
      const validatedMapping = validateGroupFolderMapping(mapping);
      this.state.mappings[validatedMapping.groupId] = validatedMapping;
      await this.saveState();
      this.notify({
        type: 'mapping-added',
        data: { mappings: this.state.mappings }
      });
    }, ErrorType.STORAGE);
  }

  async updateMapping(groupId: TabGroupId, updates: Partial<GroupFolderMapping>): Promise<void> {
    if (!this.state.mappings[groupId]) return;

    this.state.mappings[groupId] = {
      ...this.state.mappings[groupId],
      ...updates
    };
    
    await this.saveState();
    this.notify({
      type: 'mapping-updated',
      data: { mappings: this.state.mappings }
    });
  }

  async removeMapping(groupId: TabGroupId): Promise<void> {
    delete this.state.mappings[groupId];
    await this.saveState();
    this.notify({
      type: 'mapping-removed',
      data: { mappings: this.state.mappings }
    });
  }

  async getFolderMapping(folderId: BookmarkFolderId): Promise<GroupFolderMapping | undefined> {
    await this.loadState();
    return Object.values(this.state.mappings).find(
      mapping => mapping.folderId === folderId
    );
  }

  // Sync History Management
  async addHistoryEntry(entry: SyncHistoryEntry): Promise<void> {
    return withErrorHandling(async () => {
      const validatedEntry = validateSyncHistoryEntry(entry);
      this.state.syncHistory = [validatedEntry, ...this.state.syncHistory].slice(0, 100);
      await this.saveState();
      this.notify({
        type: 'history-added',
        data: { syncHistory: this.state.syncHistory }
      });
    }, ErrorType.STORAGE);
  }

  async getHistory(): Promise<SyncHistoryEntry[]> {
    await this.loadState();
    return this.state.syncHistory;
  }

  // Ungrouped Tabs Management
  async getUngroupedSettings() {
    await this.loadState();
    return this.state.ungroupedTabs;
  }

  async updateUngroupedSettings(updates: Partial<typeof DEFAULT_STATE.ungroupedTabs>) {
    this.state.ungroupedTabs = {
      ...this.state.ungroupedTabs,
      ...updates
    };
    await this.saveState();
    this.notify({
      type: 'settings-changed',
      data: { ungroupedTabs: this.state.ungroupedTabs }
    });
  }

  // Utility Methods
  async clearAllData(): Promise<void> {
    this.state = DEFAULT_STATE;
    await this.saveState();
    this.notify({
      type: 'settings-changed',
      data: this.state
    });
  }

  async exportData(): Promise<string> {
    await this.loadState();
    return JSON.stringify(this.state, null, 2);
  }

  async importData(jsonData: string): Promise<void> {
    return withErrorHandling(async () => {
      try {
        const parsedState = JSON.parse(jsonData);
        const validatedState = validateStorageState(parsedState);
        this.state = this.migrateStateIfNeeded(validatedState);
        await this.saveState();
        this.notify({
          type: 'settings-changed',
          data: this.state
        });
      } catch (error) {
        throw new StorageError('Invalid import data', error);
      }
    }, ErrorType.STORAGE);
  }
}
