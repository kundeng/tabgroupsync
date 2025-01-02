import { ValidationError } from './errors';
import {
  StorageState,
  GroupFolderMapping,
  SyncHistoryEntry,
  GlobalSettings,
  UngroupedTabsSettings,
  SyncStatus
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

export function validateGroupFolderMapping(mapping: unknown): GroupFolderMapping {
  if (!mapping || typeof mapping !== 'object') {
    throw new ValidationError('Invalid group folder mapping object');
  }

  const {
    groupId,
    folderId,
    name,
    color,
    syncEnabled,
    status
  } = mapping as GroupFolderMapping;

  return {
    groupId: validateNumber(groupId, 'groupId'),
    folderId: validateString(folderId, 'folderId'),
    name: validateString(name, 'name'),
    color: validateOptional(color, v => validateString(v, 'color')),
    syncEnabled: validateBoolean(syncEnabled, 'syncEnabled'),
    status: validateSyncStatus(status)
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

  if (!['group-to-folder', 'folder-to-group', 'ungrouped'].includes(type)) {
    throw new ValidationError('Invalid sync history type');
  }

  return {
    timestamp: validateNumber(timestamp, 'timestamp'),
    type,
    groupId: validateOptional(groupId, v => validateNumber(v, 'groupId')),
    folderId: validateString(folderId, 'folderId'),
    success: validateBoolean(success, 'success'),
    error: validateOptional(error, v => validateString(v, 'error'))
  };
}

export function validateGlobalSettings(settings: unknown): GlobalSettings {
  if (!settings || typeof settings !== 'object') {
    throw new ValidationError('Invalid global settings object');
  }

  const {
    autoSync,
    parentFolderId,
    syncInterval,
    keepRemoved,
    syncUngrouped
  } = settings as GlobalSettings;

  return {
    autoSync: validateBoolean(autoSync, 'autoSync'),
    parentFolderId: validateOptional(parentFolderId, v => validateString(v, 'parentFolderId')),
    syncInterval: validateOptional(syncInterval, v => validateNumber(v, 'syncInterval')),
    keepRemoved: validateBoolean(keepRemoved, 'keepRemoved'),
    syncUngrouped: validateBoolean(syncUngrouped, 'syncUngrouped')
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

export function validateStorageState(state: unknown): StorageState {
  if (!state || typeof state !== 'object') {
    throw new ValidationError('Invalid storage state object');
  }

  const {
    version,
    settings,
    mappings,
    ungroupedTabs,
    syncHistory
  } = state as StorageState;

  // Validate version
  const validatedVersion = validateNumber(version, 'version');

  // Validate settings
  const validatedSettings = validateGlobalSettings(settings);

  // Validate mappings
  const validatedMappings: Record<number, GroupFolderMapping> = {};
  if (typeof mappings !== 'object') {
    throw new ValidationError('Invalid mappings object');
  }
  
  Object.entries(mappings).forEach(([key, value]) => {
    validatedMappings[Number(key)] = validateGroupFolderMapping(value);
  });

  // Validate ungrouped tabs settings
  const validatedUngroupedTabs = validateUngroupedTabsSettings(ungroupedTabs);

  // Validate sync history
  if (!Array.isArray(syncHistory)) {
    throw new ValidationError('Sync history must be an array');
  }
  const validatedSyncHistory = syncHistory.map(entry => 
    validateSyncHistoryEntry(entry)
  );

  return {
    version: validatedVersion,
    settings: validatedSettings,
    mappings: validatedMappings,
    ungroupedTabs: validatedUngroupedTabs,
    syncHistory: validatedSyncHistory
  };
}
