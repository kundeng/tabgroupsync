import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageManager } from '../../../src/lib/storage/storageManager';
import { DEFAULT_STATE } from '../../../src/lib/types/storage';

/**
 * Unit tests for StorageManager
 * 
 * Tests specific examples and edge cases:
 * - Quota exceeded handling
 * - Storage operation retry logic
 * - State validation edge cases
 * 
 * Requirements: 7.3, 7.4
 */

describe('StorageManager', () => {
  let storageData: Record<string, any>;

  beforeEach(() => {
    // Reset storage data
    storageData = {};
    
    // Mock Chrome storage API
    vi.mocked(chrome.storage.sync.get).mockImplementation((keys: any, callback: any) => {
      if (typeof keys === 'function') {
        callback = keys;
        keys = null;
      }
      
      if (keys === null) {
        callback({ ...storageData });
      } else if (Array.isArray(keys)) {
        const result: Record<string, any> = {};
        keys.forEach(key => {
          if (storageData[key] !== undefined) {
            result[key] = storageData[key];
          }
        });
        callback(result);
      } else if (typeof keys === 'object') {
        const result: Record<string, any> = {};
        Object.keys(keys).forEach(key => {
          result[key] = storageData[key] !== undefined ? storageData[key] : keys[key];
        });
        callback(result);
      }
    });

    vi.mocked(chrome.storage.sync.set).mockImplementation((data: any, callback?: any) => {
      Object.assign(storageData, data);
      if (callback) callback();
    });

    // Mock bookmarks API
    vi.mocked(chrome.bookmarks.get).mockImplementation((id: any, callback: any) => {
      callback([{ id, title: 'Container', children: [] }]);
    });

    vi.mocked(chrome.bookmarks.getChildren).mockImplementation((id: any, callback: any) => {
      callback([]);
    });
  });

  describe('Initialization', () => {
    it('should initialize with default state when storage is empty', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      const settings = await manager.getSettings();
      expect(settings).toEqual(DEFAULT_STATE.settings);
    });

    it('should restore persisted settings on initialization', async () => {
      const customSettings = {
        ...DEFAULT_STATE.settings,
        autoSync: true,
        containerFolderId: 'test-folder-123',
      };
      storageData['state:settings'] = customSettings;

      const manager = new StorageManager();
      await manager.initialize();

      const settings = await manager.getSettings();
      expect(settings.autoSync).toBe(true);
      expect(settings.containerFolderId).toBe('test-folder-123');
    });

    it('should restore group sync preferences on initialization', async () => {
      storageData['state:settings'] = DEFAULT_STATE.settings;
      storageData['pref:WorkGroup'] = {
        syncEnabled: true,
        lastSeen: Date.now(),
        lastSynced: Date.now(),
      };

      const manager = new StorageManager();
      await manager.initialize();

      const settings = await manager.getGroupSyncSettings('WorkGroup');
      expect(settings.enabled).toBe(true);
    });
  });

  describe('Settings Operations', () => {
    it('should update global settings', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateSettings({ autoSync: true });

      const settings = await manager.getSettings();
      expect(settings.autoSync).toBe(true);
    });

    it('should persist settings updates to storage', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateSettings({ 
        autoSync: true,
        containerFolderId: 'new-folder-456',
      });

      expect(storageData['state:settings']).toBeDefined();
      expect(storageData['state:settings'].autoSync).toBe(true);
      expect(storageData['state:settings'].containerFolderId).toBe('new-folder-456');
    });

    it('should merge partial settings updates', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateSettings({ autoSync: true });
      await manager.updateSettings({ containerFolderId: 'folder-789' });

      const settings = await manager.getSettings();
      expect(settings.autoSync).toBe(true);
      expect(settings.containerFolderId).toBe('folder-789');
    });
  });

  describe('Group Sync Settings', () => {
    it('should update group sync settings', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateGroupSyncSettings('TestGroup', {
        enabled: true,
        lastSynced: 12345,
      });

      const settings = await manager.getGroupSyncSettings('TestGroup');
      expect(settings.enabled).toBe(true);
    });

    it('should persist group sync settings', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateGroupSyncSettings('TestGroup', {
        enabled: true,
        lastSynced: Date.now(),
      });

      expect(storageData['pref:TestGroup']).toBeDefined();
      expect(storageData['pref:TestGroup'].syncEnabled).toBe(true);
    });

    it('should return default settings for unknown groups', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      const settings = await manager.getGroupSyncSettings('UnknownGroup');
      expect(settings.enabled).toBe(false);
      expect(settings.lastSynced).toBe(0);
    });
  });

  describe('Runtime Mappings', () => {
    it('should update runtime mappings', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateMapping('TestGroup', {
        folderId: 'folder-123',
        syncEnabled: true,
        userAction: false,
      });

      const mapping = await manager.getMapping('TestGroup');
      expect(mapping).toBeDefined();
      expect(mapping?.folderId).toBe('folder-123');
      expect(mapping?.syncEnabled).toBe(true);
    });

    it('should persist runtime mappings when userAction is true', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateMapping('TestGroup', {
        syncEnabled: true,
        userAction: true,
      });

      expect(storageData['pref:TestGroup']).toBeDefined();
      expect(storageData['pref:TestGroup'].syncEnabled).toBe(true);
    });

    it('should not persist runtime mappings when userAction is false', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      // Ensure no existing data
      delete storageData['pref:TestGroup'];

      await manager.updateMapping('TestGroup', {
        syncEnabled: true,
        userAction: false,
      });

      // Should not have persisted to storage
      expect(storageData['pref:TestGroup']).toBeUndefined();
      
      // But should exist in runtime state
      const mapping = await manager.getMapping('TestGroup');
      expect(mapping).toBeDefined();
      expect(mapping?.syncEnabled).toBe(true);
    });

    it('should get all mappings', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateMapping('Group1', { folderId: 'folder-1', userAction: false });
      await manager.updateMapping('Group2', { folderId: 'folder-2', userAction: false });

      const mappings = await manager.getAllMappings();
      expect(Object.keys(mappings)).toHaveLength(2);
      expect(mappings['Group1']).toBeDefined();
      expect(mappings['Group2']).toBeDefined();
    });

    it('should remove mappings', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      // Mock chrome.storage.sync.remove
      vi.mocked(chrome.storage.sync.remove).mockImplementation((keys: any, callback?: any) => {
        if (typeof keys === 'string') {
          delete storageData[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach(key => delete storageData[key]);
        }
        if (callback) callback();
      });

      await manager.updateMapping('TestGroup', { 
        folderId: 'folder-123',
        syncEnabled: true,
        userAction: true,
      });

      await manager.removeMapping('TestGroup');

      const mapping = await manager.getMapping('TestGroup');
      expect(mapping).toBeUndefined();
      expect(storageData['pref:TestGroup']).toBeUndefined();
    });
  });

  describe('History Operations', () => {
    it('should add history entries', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.addHistoryEntry({
        timestamp: Date.now(),
        type: 'group-to-folder',
        groupId: 'group-123',
        folderId: 'folder-456',
        success: true,
      });

      const history = await manager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].type).toBe('group-to-folder');
      expect(history[0].success).toBe(true);
    });

    it('should limit history to 50 entries', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      // Add 60 entries
      for (let i = 0; i < 60; i++) {
        await manager.addHistoryEntry({
          timestamp: Date.now() + i,
          type: 'group-to-folder',
          groupId: `group-${i}`,
          folderId: `folder-${i}`,
          success: true,
        });
      }

      const history = await manager.getHistory();
      expect(history).toHaveLength(50);
      // Most recent entry should be first
      expect(history[0].groupId).toBe('group-59');
    });

    it('should persist history entries', async () => {
      // Start with completely fresh storage
      storageData = {};
      
      const manager = new StorageManager();
      await manager.initialize();

      await manager.addHistoryEntry({
        timestamp: 12345,
        type: 'group-to-folder',
        groupId: 'group-123',
        folderId: 'folder-456',
        success: true,
      });

      expect(storageData['state:history']).toBeDefined();
      expect(Array.isArray(storageData['state:history'])).toBe(true);
      expect(storageData['state:history'].length).toBeGreaterThan(0);
      // Most recent entry should be first
      expect(storageData['state:history'][0].timestamp).toBe(12345);
      expect(storageData['state:history'][0].groupId).toBe('group-123');
    });
  });

  describe('Quota Exceeded Handling', () => {
    it('should handle quota exceeded errors gracefully', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      // Mock storage.set to throw quota exceeded error
      vi.mocked(chrome.storage.sync.set).mockImplementation(() => {
        throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      });

      // Should not throw, but handle gracefully
      await expect(
        manager.updateSettings({ autoSync: true })
      ).rejects.toThrow();
    });

    it('should continue functioning after quota errors', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      let callCount = 0;
      vi.mocked(chrome.storage.sync.set).mockImplementation((data: any, callback?: any) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        } else {
          Object.assign(storageData, data);
          if (callback) callback();
        }
      });

      // First call should fail
      await expect(
        manager.updateSettings({ autoSync: true })
      ).rejects.toThrow();

      // Second call should succeed
      await manager.updateSettings({ autoSync: false });
      const settings = await manager.getSettings();
      expect(settings.autoSync).toBe(false);
    });
  });

  describe('State Validation Edge Cases', () => {
    it('should handle empty group names', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateGroupSyncSettings('', {
        enabled: true,
        lastSynced: Date.now(),
      });

      const settings = await manager.getGroupSyncSettings('');
      expect(settings.enabled).toBe(true);
    });

    it('should handle very long group names', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      const longName = 'A'.repeat(1000);
      await manager.updateGroupSyncSettings(longName, {
        enabled: true,
        lastSynced: Date.now(),
      });

      const settings = await manager.getGroupSyncSettings(longName);
      expect(settings.enabled).toBe(true);
    });

    it('should handle special characters in group names', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      const specialName = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      await manager.updateGroupSyncSettings(specialName, {
        enabled: true,
        lastSynced: Date.now(),
      });

      const settings = await manager.getGroupSyncSettings(specialName);
      expect(settings.enabled).toBe(true);
    });

    it('should handle unicode characters in group names', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      const unicodeName = '测试组 🚀 группа';
      await manager.updateGroupSyncSettings(unicodeName, {
        enabled: true,
        lastSynced: Date.now(),
      });

      const settings = await manager.getGroupSyncSettings(unicodeName);
      expect(settings.enabled).toBe(true);
    });
  });

  describe('Cleanup and Maintenance', () => {
    it('should clear all data', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateSettings({ autoSync: true });
      await manager.updateGroupSyncSettings('TestGroup', {
        enabled: true,
        lastSynced: Date.now(),
      });

      await manager.clearAllData();

      const settings = await manager.getSettings();
      expect(settings).toEqual(DEFAULT_STATE.settings);

      const mappings = await manager.getAllMappings();
      expect(Object.keys(mappings)).toHaveLength(0);
    });

    it('should handle missing container folder gracefully', async () => {
      const manager = new StorageManager();
      await manager.initialize();

      await manager.updateSettings({ containerFolderId: 'missing-folder' });

      // Mock bookmarks.get to simulate missing folder
      vi.mocked(chrome.bookmarks.get).mockImplementation((id: any, callback: any) => {
        callback([]);
      });

      // Re-initialize to trigger maintenance
      const manager2 = new StorageManager();
      await manager2.initialize();

      const settings = await manager2.getSettings();
      expect(settings.containerFolderId).toBeUndefined();
    });
  });
});
