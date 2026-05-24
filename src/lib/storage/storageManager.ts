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
  GroupSyncPreferences,
  PathMappingConfig,
  PathMappingStore
} from '../types/storage';
import { validateStorageState, validateSyncHistoryEntry } from '../utils/validators';
import { StorageError, withErrorHandling, ErrorType } from '../utils/errors';
import { Logger } from '../utils/logger';
import { BOOKMARK_FOLDERS } from '../constants';

export class StorageManager {
  private persistedState: StorageState;
  private runtimeState: RuntimeState;
  private logger = Logger.getInstance();

  constructor() {
    this.persistedState = DEFAULT_STATE;
    // Use Object.create(null) to avoid prototype pollution
    this.runtimeState = {
      mappings: Object.create(null),
      groupSettings: Object.create(null)
    };
  }

  private async saveState(): Promise<void> {
    // Save essential data
    const data: Record<string, any> = {
      'state:settings': this.persistedState.settings,
      'state:history': this.persistedState.syncHistory.slice(-50) // Keep last 50 entries
    };

    // Save sync preferences that have been explicitly set by user
    Object.entries(this.persistedState.syncPreferences).forEach(([name, pref]) => {
      if (pref.userSet) {  // Only save preferences that user has explicitly set
        data[`pref:${name}`] = {
          syncEnabled: pref.syncEnabled,
          lastSeen: pref.lastSeen,    // For cleanup functionality
          lastSynced: pref.lastSynced // For sync state persistence
        };
      }
    });

    // Save in a single operation (promise-based per NF 2)
    try {
      await chrome.storage.sync.set(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      // Log informative messages for quota and storage errors (Req 8.4)
      if (message.toLowerCase().includes('quota') || message.toLowerCase().includes('exceeded')) {
        this.logger.error('storage:saveState:quotaExceeded', error, {
          message: `Storage quota exceeded — consider removing unused sync preferences`,
          dataKeys: Object.keys(data).length
        });
      } else {
        this.logger.error('storage:saveState:failed', error, {
          message,
          dataKeys: Object.keys(data).length
        });
      }
      
      throw error;
    }
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
      // Load settings and history (promise-based per NF 2)
      const data = await (chrome.storage.sync.get(['state:settings', 'state:history']) as unknown as Promise<{ [key: string]: any }>);

      try {
        if (data['state:settings']) {
          // Get all preference keys
          const allKeys = await (chrome.storage.sync.get(null) as unknown as Promise<{ [key: string]: any }>);

          // Extract group preferences - use Object.create(null) to avoid prototype pollution
          const preferences: GroupSyncPreferences = Object.create(null);
          for (const [key, value] of Object.entries(allKeys)) {
            if (key.startsWith('pref:')) {
              const name = key.slice(5); // Remove 'pref:' prefix
              
              // Validate preference data before using it
              if (value && typeof value === 'object' && typeof value.syncEnabled === 'boolean') {
                preferences[name] = {
                  syncEnabled: value.syncEnabled,
                  userSet: true,  // If it's in storage, it was user-set
                  lastSeen: value.lastSeen ?? Date.now(),
                  lastSynced: value.lastSynced ?? 0
                };
              }
            }
          }

          // Reconstruct state
          const state = {
            version: DEFAULT_STATE.version,
            settings: data['state:settings'] as GlobalSettings,
            syncPreferences: preferences,
            syncHistory: data['state:history'] || [] // Load history from storage
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
        // Log the error but recover gracefully
        this.logger.error('storage:loadState:failed', error, {
          action: 'resetting to default state'
        });
        this.persistedState = DEFAULT_STATE;
        await this.saveState();
        // Don't throw - recover gracefully
      }
    }, ErrorType.STORAGE);
  }

  // Three-tier container folder resolution
  // Tier 1: Try stored ID with retries
  // Tier 2: Search by signature (child folders match) using stored name
  // Tier 3: API errors on all retries → 'unverified', preserve config
  async resolveContainerFolder(): Promise<'exists' | 'relocated' | 'deleted' | 'unverified'> {
    const settings = this.persistedState.settings;
    if (!settings.containerFolderId) return 'deleted';

    const MAX_RETRIES = 3;
    const RETRY_DELAY = 500;

    // Tier 1: Try stored ID with retries
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const results = await chrome.bookmarks.get(settings.containerFolderId!);
        if (results && results.length > 0) {
          // Also populate containerFolderName if missing (backward compat)
          if (!settings.containerFolderName && results[0].title) {
            this.persistedState.settings.containerFolderName = results[0].title;
          }
          return 'exists';
        }
        // Empty result = folder genuinely deleted, fall through to Tier 2
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // "Can't find bookmark" type errors mean the ID is invalid → fall to Tier 2
        if (message.includes("Can't find") || message.includes('not found') || message.includes('No bookmark')) {
          break;
        }
        // Transient API error → retry
        if (attempt < MAX_RETRIES) {
          this.logger.warn('resolveContainerFolder:retry', { attempt, error: message });
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
          continue;
        }
        // All retries exhausted with API errors → Tier 3: unverified
        this.logger.error('resolveContainerFolder:unverified', {
          error: message,
          attempts: MAX_RETRIES,
          action: 'preserving config'
        });
        return 'unverified';
      }
    }

    // Tier 2: ID not found — search by signature using stored name
    if (settings.containerFolderName) {
      try {
        const candidates = await chrome.bookmarks.search({ title: settings.containerFolderName });
        for (const candidate of candidates) {
          // Skip bookmarks (only want folders)
          if (candidate.url) continue;
          try {
            const children = await chrome.bookmarks.getChildren(candidate.id);
            const hasBookmarks = children.some(c => !c.url && c.title === BOOKMARK_FOLDERS.BOOKMARKS);
            const hasSnapshots = children.some(c => !c.url && c.title === BOOKMARK_FOLDERS.SNAPSHOTS);
            if (hasBookmarks && hasSnapshots) {
              // Found relocated folder — update stored ID
              const oldId = settings.containerFolderId;
              this.persistedState.settings.containerFolderId = candidate.id;
              this.persistedState.settings.containerFolderName = candidate.title;
              this.logger.info('resolveContainerFolder:relocated', {
                oldId,
                newId: candidate.id,
                name: candidate.title
              });
              return 'relocated';
            }
          } catch {
            // Skip candidates that error on getChildren
            continue;
          }
        }
      } catch (error) {
        this.logger.error('resolveContainerFolder:searchFailed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Search API failed — treat as unverified to be safe
        return 'unverified';
      }
    }

    // No folder found by ID or signature — genuinely deleted
    this.logger.warn('resolveContainerFolder:deleted', {
      oldId: settings.containerFolderId,
      oldName: settings.containerFolderName
    });
    this.persistedState.settings.containerFolderId = undefined;
    this.persistedState.settings.containerFolderName = undefined;
    return 'deleted';
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

    // Verify container folder using three-tier resolution
    if (this.persistedState.settings.containerFolderId) {
      const resolution = await this.resolveContainerFolder();
      
      if (resolution === 'deleted') {
        // Genuinely deleted — update runtime mappings to show error
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
        this.logger.warn('maintenance:containerFolderDeleted', {
          action: 'cleared container folder ID'
        });
      } else if (resolution === 'unverified') {
        // API errors — preserve config, log warning
        this.logger.warn('maintenance:containerFolderUnverified', {
          action: 'preserving config, will retry next cycle'
        });
      }
      // 'exists' and 'relocated' are handled by resolveContainerFolder itself
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
        const groupFolders = await chrome.bookmarks.getChildren(containerFolder.id);
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
          syncEnabled: pref.syncEnabled, // Keep user's preference
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
    
    // Use three-tier resolution instead of aggressive clearing
    const resolution = await this.resolveContainerFolder();
    if (resolution === 'deleted') {
      await this.saveState();
      return null;
    }
    if (resolution === 'unverified') {
      // Can't verify but config preserved — try to use stored ID anyway
      this.logger.warn('getTabGroupsFolder:unverified', { action: 'attempting with stored ID' });
    }
    // 'exists' or 'relocated' — use the (possibly updated) containerFolderId
    try {
      const results = await chrome.bookmarks.get(this.persistedState.settings.containerFolderId!);
      if (results && results.length > 0) {
        return results[0];
      }
      return null;
    } catch (error) {
      this.logger.error('getTabGroupsFolder:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
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
      userSet: true,  // This is always a user action
      lastSynced: Date.now(),
      lastSeen: Date.now()
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

  // Update runtime mapping without persisting to storage
  updateRuntimeMapping(name: string, mapping: RuntimeMapping): void {
    this.runtimeState.mappings[name] = mapping;
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

    // Only persist if sync enabled state was explicitly changed by user
    if (update.syncEnabled !== undefined && update.userAction === true) {
      this.persistedState.syncPreferences[name] = {
        syncEnabled: update.syncEnabled,
        userSet: true,  // Mark as explicitly set by user
        lastSeen: Date.now(),
        lastSynced: Date.now()
      };
      await this.saveState();
    }

    this.notify('mapping-changed', {});
  }

  async removeMapping(name: string): Promise<void> {
    delete this.runtimeState.mappings[name];
    delete this.persistedState.syncPreferences[name];
    
    // Remove from Chrome storage
    await new Promise<void>((resolve) => {
      chrome.storage.sync.remove(`pref:${name}`, resolve);
    });
    
    this.notify('mapping-changed', {});
  }

  async getMapping(name: string): Promise<RuntimeMapping | undefined> {
    return this.runtimeState.mappings[name];
  }

  async getAllMappings(): Promise<Record<string, RuntimeMapping>> {
    return this.runtimeState.mappings;
  }

  // History Operations
  async addHistoryEntry(entry: SyncHistoryEntry, options?: { persistToStorage?: boolean }): Promise<void> {
    const persist = options?.persistToStorage ?? true;

    // Add to history and keep last 50 entries
    this.persistedState.syncHistory = [
      entry,
      ...this.persistedState.syncHistory
    ].slice(0, 50);

    // Log and notify
    this.logger.info('sync:history', entry);
    this.notify('history-added', { syncHistory: [entry] });

    // Save state only if persisting (skip for no-change syncs)
    if (persist) {
      await this.saveState();
    }
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

  // Path Mapping Operations
  async getPathMappingConfig(): Promise<PathMappingConfig> {
    const machineId = await this.getCurrentMachineId();
    if (!machineId) return { machineId: '', rules: [] };

    const store = this.persistedState.settings.pathMappings;
    if (!store?.machines[machineId]) return { machineId, rules: [] };

    return store.machines[machineId];
  }

  async setPathMappingConfig(config: PathMappingConfig): Promise<void> {
    const store: PathMappingStore = this.persistedState.settings.pathMappings ?? { machines: {} };
    store.machines[config.machineId] = config;
    this.persistedState.settings.pathMappings = store;
    await this.saveState();
    this.notify('settings-changed', this.persistedState);
  }

  async getAllMachineConfigs(): Promise<PathMappingStore> {
    return this.persistedState.settings.pathMappings ?? { machines: {} };
  }

  async getCurrentMachineId(): Promise<string | undefined> {
    const data = await chrome.storage.local.get('machineId');
    return data.machineId as string | undefined;
  }

  async setCurrentMachineId(id: string): Promise<void> {
    await chrome.storage.local.set({ machineId: id });
  }

  async clearAllData(): Promise<void> {
    this.persistedState = DEFAULT_STATE;
    this.runtimeState = {
      mappings: Object.create(null),
      groupSettings: Object.create(null)
    };
    await this.saveState();
    this.notify('settings-changed', this.persistedState);
  }

  private async migrateStateIfNeeded(state: StorageState): Promise<StorageState> {
    // No migrations needed, we use a simple storage approach
    if (state.version !== DEFAULT_STATE.version) {
      this.logger.warn('storage:unknownVersion', {
        version: state.version,
        action: 'reset to default'
      });
      return DEFAULT_STATE;
    }
    return state;
  }
}
