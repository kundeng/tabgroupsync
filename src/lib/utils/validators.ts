import { ValidationError } from './errors';
import {
  StorageState,
  SyncHistoryEntry,
  GlobalSettings,
  UngroupedTabsSettings,
  SyncStatus,
  CleanupSettings,
  RuntimeMapping,
  RuntimeMappingUpdate,
  GroupSyncSettings,
  GroupSyncPreferences
} from '../types/storage';

// Validation helper functions
function validateString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`);
  }
  return value;
}

function validateNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new ValidationError(`${fieldName} must be a number`);
  }
  return value;
}

function validateBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${fieldName} must be a boolean`);
  }
  return value;
}

function validateOptional<T>(value: unknown, validator: (v: unknown) => T): T | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return validator(value);
}

// Specific validators for each type
export function validateSyncStatus(status: unknown): SyncStatus {
  if (!status || typeof status !== 'object') {
    throw new ValidationError('Invalid sync status object');
  }

  const { lastSynced, error, inProgress } = status as SyncStatus;
  
  return {
    lastSynced: validateNumber(lastSynced, 'lastSynced'),
    error: validateOptional(error, v => validateString(v, 'error')),
    inProgress: validateBoolean(inProgress, 'inProgress')
  };
}

export function validateSyncHistoryEntry(entry: unknown): SyncHistoryEntry {
  if (!entry || typeof entry !== 'object') {
    throw new ValidationError('Invalid sync history entry object');
  }

  const {
    timestamp,
    type,
    groupId,
    folderId,
    success,
    error
  } = entry as SyncHistoryEntry;

  if (!['group-to-folder', 'folder-to-group', 'ungrouped', 'archived'].includes(type)) {
    throw new ValidationError('Invalid sync history type');
  }

  return {
    timestamp: validateNumber(timestamp, 'timestamp'),
    type,
    groupId: validateOptional(groupId, v => validateString(v, 'groupId')),
    folderId: validateString(folderId, 'folderId'),
    success: validateBoolean(success, 'success'),
    error: validateOptional(error, v => validateString(v, 'error'))
  };
}

export function validateCleanupSettings(settings: unknown): CleanupSettings {
  if (!settings || typeof settings !== 'object') {
    throw new ValidationError('Invalid cleanup settings object');
  }

  const {
    enabled,
    inactiveThreshold,
    autoArchive,
    deleteThreshold
  } = settings as CleanupSettings;

  return {
    enabled: validateBoolean(enabled, 'enabled'),
    inactiveThreshold: validateNumber(inactiveThreshold, 'inactiveThreshold'),
    autoArchive: validateBoolean(autoArchive, 'autoArchive'),
    deleteThreshold: validateNumber(deleteThreshold, 'deleteThreshold')
  };
}

export function validateGlobalSettings(settings: unknown): GlobalSettings {
  if (!settings || typeof settings !== 'object') {
    throw new ValidationError('Invalid global settings object');
  }

  const {
    autoSync,
    containerFolderId,
    syncInterval,
    keepRemoved,
    syncUngrouped,
    cleanup
  } = settings as GlobalSettings;

  return {
    autoSync: validateBoolean(autoSync, 'autoSync'),
    containerFolderId: validateOptional(containerFolderId, v => validateString(v, 'containerFolderId')),
    syncInterval: validateOptional(syncInterval, v => validateNumber(v, 'syncInterval')),
    keepRemoved: validateBoolean(keepRemoved, 'keepRemoved'),
    syncUngrouped: validateBoolean(syncUngrouped, 'syncUngrouped'),
    cleanup: validateCleanupSettings(cleanup)
  };
}

export function validateUngroupedTabsSettings(settings: unknown): UngroupedTabsSettings {
  if (!settings || typeof settings !== 'object') {
    throw new ValidationError('Invalid ungrouped tabs settings object');
  }

  const {
    enabled,
    folderId,
    folderName,
    syncEnabled,
    status
  } = settings as UngroupedTabsSettings;

  return {
    enabled: validateBoolean(enabled, 'enabled'),
    folderId: validateOptional(folderId, v => validateString(v, 'folderId')),
    folderName: validateString(folderName, 'folderName'),
    syncEnabled: validateBoolean(syncEnabled, 'syncEnabled'),
    status: validateSyncStatus(status)
  };
}

export function validateGroupSyncSettings(settings: unknown): GroupSyncSettings {
  if (!settings || typeof settings !== 'object') {
    throw new ValidationError('Invalid group sync settings object');
  }

  const {
    enabled,
    folderId,
    lastSynced
  } = settings as GroupSyncSettings;

  return {
    enabled: validateBoolean(enabled, 'enabled'),
    folderId: validateOptional(folderId, v => validateString(v, 'folderId')),
    lastSynced: validateOptional(lastSynced, v => validateNumber(v, 'lastSynced'))
  };
}

export function validateRuntimeMapping(mapping: unknown): RuntimeMapping {
  if (!mapping || typeof mapping !== 'object') {
    throw new ValidationError('Invalid runtime mapping object');
  }

  const {
    name,
    folderId,
    currentGroupId,
    color,
    syncEnabled,
    status
  } = mapping as RuntimeMapping;

  return {
    name: validateString(name, 'name'),
    folderId: validateString(folderId, 'folderId'),
    currentGroupId: validateOptional(currentGroupId, v => validateString(v, 'currentGroupId')),
    color: validateOptional(color, v => validateString(v, 'color')),
    syncEnabled: validateBoolean(syncEnabled, 'syncEnabled'),
    status: validateSyncStatus(status)
  };
}

export function validateGroupSyncPreference(pref: unknown): { syncEnabled: boolean; lastSynced?: number } {
  if (!pref || typeof pref !== 'object') {
    throw new ValidationError('Invalid group sync preference object');
  }

  const { syncEnabled, lastSynced } = pref as { syncEnabled: boolean; lastSynced?: number };

  return {
    syncEnabled: validateBoolean(syncEnabled, 'syncEnabled'),
    lastSynced: validateOptional(lastSynced, v => validateNumber(v, 'lastSynced'))
  };
}

export function validateStorageState(state: unknown): StorageState {
  if (!state || typeof state !== 'object') {
    throw new ValidationError('Invalid storage state object');
  }

  const {
    version,
    settings,
    syncHistory,
    syncPreferences
  } = state as StorageState;

  // Validate version
  const validatedVersion = validateNumber(version, 'version');

  // Validate settings
  const validatedSettings = validateGlobalSettings(settings);

  // Validate sync history
  if (!Array.isArray(syncHistory)) {
    throw new ValidationError('Sync history must be an array');
  }
  const validatedSyncHistory = syncHistory.map(entry => 
    validateSyncHistoryEntry(entry)
  );

  // Validate sync preferences
  const validatedSyncPreferences: GroupSyncPreferences = {};
  if (typeof syncPreferences === 'object' && syncPreferences !== null) {
    Object.entries(syncPreferences).forEach(([name, pref]) => {
      validatedSyncPreferences[name] = validateGroupSyncPreference(pref);
    });
  }

  return {
    version: validatedVersion,
    settings: validatedSettings,
    syncHistory: validatedSyncHistory,
    syncPreferences: validatedSyncPreferences
  };
}
