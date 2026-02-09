import { describe, it, expect } from 'vitest';
import {
  validateSyncStatus,
  validateSyncHistoryEntry,
  validateCleanupSettings,
  validateGlobalSettings,
  validateGroupSyncSettings,
  validateRuntimeMapping,
  validateGroupSyncPreference,
  validateStorageState,
} from '../../../src/lib/utils/validators';
import { ValidationError } from '../../../src/lib/utils/errors';

describe('validators', () => {
  describe('validateSyncStatus', () => {
    it('should validate valid sync status', () => {
      const status = {
        lastSynced: 1234567890,
        error: undefined,
        inProgress: false,
      };

      const result = validateSyncStatus(status);

      expect(result).toEqual(status);
    });

    it('should validate sync status with error', () => {
      const status = {
        lastSynced: 1234567890,
        error: 'Sync failed',
        inProgress: false,
      };

      const result = validateSyncStatus(status);

      expect(result).toEqual(status);
    });

    it('should throw on invalid object', () => {
      expect(() => validateSyncStatus(null)).toThrow(ValidationError);
      expect(() => validateSyncStatus(undefined)).toThrow(ValidationError);
      expect(() => validateSyncStatus('invalid')).toThrow(ValidationError);
    });

    it('should throw on invalid lastSynced', () => {
      const status = {
        lastSynced: 'invalid',
        error: undefined,
        inProgress: false,
      };

      expect(() => validateSyncStatus(status)).toThrow(ValidationError);
      expect(() => validateSyncStatus(status)).toThrow('lastSynced must be a number');
    });

    it('should throw on invalid inProgress', () => {
      const status = {
        lastSynced: 1234567890,
        error: undefined,
        inProgress: 'invalid',
      };

      expect(() => validateSyncStatus(status)).toThrow(ValidationError);
      expect(() => validateSyncStatus(status)).toThrow('inProgress must be a boolean');
    });
  });

  describe('validateSyncHistoryEntry', () => {
    it('should validate valid history entry', () => {
      const entry = {
        timestamp: 1234567890,
        type: 'group-to-folder' as const,
        groupId: 'group-123',
        folderId: 'folder-456',
        success: true,
        error: undefined,
        details: 'Sync completed',
      };

      const result = validateSyncHistoryEntry(entry);

      expect(result).toEqual(entry);
    });

    it('should validate entry without optional fields', () => {
      const entry = {
        timestamp: 1234567890,
        type: 'folder-to-group' as const,
        success: false,
      };

      const result = validateSyncHistoryEntry(entry);

      expect(result.timestamp).toBe(1234567890);
      expect(result.type).toBe('folder-to-group');
      expect(result.success).toBe(false);
      expect(result.groupId).toBeUndefined();
      expect(result.folderId).toBeUndefined();
    });

    it('should throw on invalid type', () => {
      const entry = {
        timestamp: 1234567890,
        type: 'invalid-type',
        success: true,
      };

      expect(() => validateSyncHistoryEntry(entry)).toThrow(ValidationError);
      expect(() => validateSyncHistoryEntry(entry)).toThrow('Invalid sync history type');
    });

    it('should throw on invalid timestamp', () => {
      const entry = {
        timestamp: 'invalid',
        type: 'group-to-folder',
        success: true,
      };

      expect(() => validateSyncHistoryEntry(entry)).toThrow(ValidationError);
    });
  });

  describe('validateCleanupSettings', () => {
    it('should validate valid cleanup settings', () => {
      const settings = {
        enabled: true,
        inactiveThreshold: 30,
        autoArchive: false,
        deleteThreshold: 90,
      };

      const result = validateCleanupSettings(settings);

      expect(result).toEqual(settings);
    });

    it('should throw on invalid object', () => {
      expect(() => validateCleanupSettings(null)).toThrow(ValidationError);
      expect(() => validateCleanupSettings('invalid')).toThrow(ValidationError);
    });

    it('should throw on invalid enabled', () => {
      const settings = {
        enabled: 'true',
        inactiveThreshold: 30,
        autoArchive: false,
        deleteThreshold: 90,
      };

      expect(() => validateCleanupSettings(settings)).toThrow(ValidationError);
    });

    it('should throw on invalid threshold', () => {
      const settings = {
        enabled: true,
        inactiveThreshold: 'thirty',
        autoArchive: false,
        deleteThreshold: 90,
      };

      expect(() => validateCleanupSettings(settings)).toThrow(ValidationError);
    });
  });

  describe('validateGlobalSettings', () => {
    it('should validate valid global settings', () => {
      const settings = {
        autoSync: true,
        containerFolderId: 'folder-123',
        syncInterval: 5000,
        keepRemoved: false,
        cleanup: {
          enabled: true,
          inactiveThreshold: 30,
          autoArchive: false,
          deleteThreshold: 90,
        },
      };

      const result = validateGlobalSettings(settings);

      expect(result).toEqual(settings);
    });

    it('should validate settings without optional fields', () => {
      const settings = {
        autoSync: false,
        keepRemoved: true,
        cleanup: {
          enabled: false,
          inactiveThreshold: 30,
          autoArchive: false,
          deleteThreshold: 90,
        },
      };

      const result = validateGlobalSettings(settings);

      expect(result.autoSync).toBe(false);
      expect(result.containerFolderId).toBeUndefined();
      expect(result.syncInterval).toBeUndefined();
    });

    it('should throw on invalid cleanup settings', () => {
      const settings = {
        autoSync: true,
        keepRemoved: false,
        cleanup: {
          enabled: 'invalid',
          inactiveThreshold: 30,
          autoArchive: false,
          deleteThreshold: 90,
        },
      };

      expect(() => validateGlobalSettings(settings)).toThrow(ValidationError);
    });
  });

  describe('validateGroupSyncSettings', () => {
    it('should validate valid group sync settings', () => {
      const settings = {
        enabled: true,
        folderId: 'folder-123',
        lastSynced: 1234567890,
      };

      const result = validateGroupSyncSettings(settings);

      expect(result).toEqual(settings);
    });

    it('should validate settings without optional fields', () => {
      const settings = {
        enabled: false,
      };

      const result = validateGroupSyncSettings(settings);

      expect(result.enabled).toBe(false);
      expect(result.folderId).toBeUndefined();
      expect(result.lastSynced).toBeUndefined();
    });

    it('should throw on invalid enabled', () => {
      const settings = {
        enabled: 'true',
      };

      expect(() => validateGroupSyncSettings(settings)).toThrow(ValidationError);
    });
  });

  describe('validateRuntimeMapping', () => {
    it('should validate valid runtime mapping', () => {
      const mapping = {
        name: 'Work Tabs',
        folderId: 'folder-123',
        currentGroupId: 'group-456',
        color: 'blue',
        syncEnabled: true,
        status: {
          lastSynced: 1234567890,
          error: undefined,
          inProgress: false,
        },
      };

      const result = validateRuntimeMapping(mapping);

      expect(result).toEqual(mapping);
    });

    it('should validate mapping without optional fields', () => {
      const mapping = {
        name: 'Work Tabs',
        folderId: 'folder-123',
        syncEnabled: false,
        status: {
          lastSynced: 1234567890,
          inProgress: false,
        },
      };

      const result = validateRuntimeMapping(mapping);

      expect(result.name).toBe('Work Tabs');
      expect(result.currentGroupId).toBeUndefined();
      expect(result.color).toBeUndefined();
    });

    it('should throw on invalid name', () => {
      const mapping = {
        name: 123,
        folderId: 'folder-123',
        syncEnabled: true,
        status: {
          lastSynced: 1234567890,
          inProgress: false,
        },
      };

      expect(() => validateRuntimeMapping(mapping)).toThrow(ValidationError);
    });

    it('should throw on invalid status', () => {
      const mapping = {
        name: 'Work Tabs',
        folderId: 'folder-123',
        syncEnabled: true,
        status: 'invalid',
      };

      expect(() => validateRuntimeMapping(mapping)).toThrow(ValidationError);
    });
  });

  describe('validateGroupSyncPreference', () => {
    it('should validate valid preference', () => {
      const pref = {
        syncEnabled: true,
        lastSynced: 1234567890,
        lastSeen: 1234567890,
      };

      const result = validateGroupSyncPreference(pref);

      expect(result).toEqual(pref);
    });

    it('should default lastSeen to current time if not provided', () => {
      const pref = {
        syncEnabled: true,
        lastSynced: 1234567890,
      };

      const result = validateGroupSyncPreference(pref);

      expect(result.syncEnabled).toBe(true);
      expect(result.lastSynced).toBe(1234567890);
      expect(result.lastSeen).toBeGreaterThan(0);
    });

    it('should throw on invalid syncEnabled', () => {
      const pref = {
        syncEnabled: 'true',
        lastSeen: 1234567890,
      };

      expect(() => validateGroupSyncPreference(pref)).toThrow(ValidationError);
    });
  });

  describe('validateStorageState', () => {
    it('should validate valid storage state', () => {
      const state = {
        version: 1,
        settings: {
          autoSync: true,
          containerFolderId: 'folder-123',
          keepRemoved: false,
          cleanup: {
            enabled: true,
            inactiveThreshold: 30,
            autoArchive: false,
            deleteThreshold: 90,
          },
        },
        syncHistory: [
          {
            timestamp: 1234567890,
            type: 'group-to-folder' as const,
            groupId: 'group-123',
            success: true,
          },
        ],
        syncPreferences: {
          'Work Tabs': {
            syncEnabled: true,
            lastSynced: 1234567890,
            lastSeen: 1234567890,
          },
        },
      };

      const result = validateStorageState(state);

      expect(result.version).toBe(1);
      expect(result.settings.autoSync).toBe(true);
      expect(result.syncHistory).toHaveLength(1);
      expect(result.syncPreferences['Work Tabs'].syncEnabled).toBe(true);
    });

    it('should handle edge case: NaN as number field', () => {
      const status = {
        lastSynced: NaN,
        inProgress: false,
      };

      expect(() => validateSyncStatus(status)).toThrow(ValidationError);
      expect(() => validateSyncStatus(status)).toThrow('lastSynced must be a number');
    });

    it('should handle edge case: negative numbers in thresholds', () => {
      const settings = {
        enabled: true,
        inactiveThreshold: -30,
        autoArchive: false,
        deleteThreshold: -90,
      };

      // Should validate successfully - negative numbers are still numbers
      const result = validateCleanupSettings(settings);
      expect(result.inactiveThreshold).toBe(-30);
      expect(result.deleteThreshold).toBe(-90);
    });

    it('should handle edge case: empty string values', () => {
      const settings = {
        enabled: true,
        folderId: '',
      };

      // Empty strings are valid strings
      const result = validateGroupSyncSettings(settings);
      expect(result.folderId).toBe('');
    });

    it('should handle edge case: very large numbers', () => {
      const entry = {
        timestamp: Number.MAX_SAFE_INTEGER,
        type: 'group-to-folder' as const,
        success: true,
      };

      const result = validateSyncHistoryEntry(entry);
      expect(result.timestamp).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle edge case: zero values', () => {
      const status = {
        lastSynced: 0,
        inProgress: false,
      };

      const result = validateSyncStatus(status);
      expect(result.lastSynced).toBe(0);
    });

    it('should handle edge case: null in optional fields', () => {
      const settings = {
        enabled: true,
        folderId: null,
        lastSynced: null,
      };

      const result = validateGroupSyncSettings(settings);
      expect(result.folderId).toBeUndefined();
      expect(result.lastSynced).toBeUndefined();
    });

    it('should validate state with empty arrays and objects', () => {
      const state = {
        version: 1,
        settings: {
          autoSync: false,
          keepRemoved: true,
          cleanup: {
            enabled: false,
            inactiveThreshold: 30,
            autoArchive: false,
            deleteThreshold: 90,
          },
        },
        syncHistory: [],
        syncPreferences: {},
      };

      const result = validateStorageState(state);

      expect(result.version).toBe(1);
      expect(result.syncHistory).toHaveLength(0);
      expect(Object.keys(result.syncPreferences)).toHaveLength(0);
    });

    it('should throw on invalid version', () => {
      const state = {
        version: '1',
        settings: {
          autoSync: true,
          keepRemoved: false,
          cleanup: {
            enabled: true,
            inactiveThreshold: 30,
            autoArchive: false,
            deleteThreshold: 90,
          },
        },
        syncHistory: [],
        syncPreferences: {},
      };

      expect(() => validateStorageState(state)).toThrow(ValidationError);
    });

    it('should throw on invalid settings', () => {
      const state = {
        version: 1,
        settings: 'invalid',
        syncHistory: [],
        syncPreferences: {},
      };

      expect(() => validateStorageState(state)).toThrow(ValidationError);
    });

    it('should throw on invalid sync history', () => {
      const state = {
        version: 1,
        settings: {
          autoSync: true,
          keepRemoved: false,
          cleanup: {
            enabled: true,
            inactiveThreshold: 30,
            autoArchive: false,
            deleteThreshold: 90,
          },
        },
        syncHistory: 'invalid',
        syncPreferences: {},
      };

      expect(() => validateStorageState(state)).toThrow(ValidationError);
    });

    it('should throw on invalid sync history entry', () => {
      const state = {
        version: 1,
        settings: {
          autoSync: true,
          keepRemoved: false,
          cleanup: {
            enabled: true,
            inactiveThreshold: 30,
            autoArchive: false,
            deleteThreshold: 90,
          },
        },
        syncHistory: [
          {
            timestamp: 'invalid',
            type: 'group-to-folder',
            success: true,
          },
        ],
        syncPreferences: {},
      };

      expect(() => validateStorageState(state)).toThrow(ValidationError);
    });

    it('should throw on invalid sync preferences', () => {
      const state = {
        version: 1,
        settings: {
          autoSync: true,
          keepRemoved: false,
          cleanup: {
            enabled: true,
            inactiveThreshold: 30,
            autoArchive: false,
            deleteThreshold: 90,
          },
        },
        syncHistory: [],
        syncPreferences: {
          'Work Tabs': {
            syncEnabled: 'invalid',
            lastSeen: 1234567890,
          },
        },
      };

      expect(() => validateStorageState(state)).toThrow(ValidationError);
    });
  });
});
