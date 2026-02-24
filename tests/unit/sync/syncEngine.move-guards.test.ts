import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine } from '../../../src/lib/sync/syncEngine';

describe('SyncEngine move-aware guards', () => {
  const makeGroup = (id: number, title = 'Work'): chrome.tabGroups.TabGroup => ({
    id,
    title,
    color: 'blue',
    windowId: 1,
    collapsed: false,
  });

  let storage: any;
  let bookmarkManager: any;
  let tabGroupManager: any;
  let engine: SyncEngine;

  beforeEach(() => {
    storage = {
      getSettings: vi.fn().mockResolvedValue({ autoSync: true, containerFolderId: 'container-1' }),
      getGroupSyncSettings: vi.fn().mockResolvedValue({ enabled: true, lastSynced: 0 }),
      getMapping: vi.fn().mockResolvedValue({
        name: 'Work',
        currentGroupId: '200',
        folderId: 'folder-1',
        syncEnabled: true,
        status: { lastSynced: 0, inProgress: false },
      }),
      updateMapping: vi.fn().mockResolvedValue(undefined),
      addHistoryEntry: vi.fn().mockResolvedValue(undefined),
      getAllMappings: vi.fn().mockResolvedValue({}),
    };

    bookmarkManager = {
      ensureGroupFolder: vi.fn().mockResolvedValue({ id: 'folder-1', title: 'Work' }),
      syncGroupToFolder: vi.fn().mockResolvedValue(undefined),
    };

    tabGroupManager = {
      getGroup: vi.fn().mockResolvedValue(null),
    };

    engine = new SyncEngine(storage, bookmarkManager, tabGroupManager);
  });

  it('ignores stale group events during move window for the same logical name', async () => {
    engine.registerMoveGuard('Work', {
      sourceGroupId: 100,
      targetGroupId: 200,
      ttlMs: 10000,
    });

    await engine.handleGroupCreated(makeGroup(100));
    await engine.handleGroupUpdated(makeGroup(100));

    expect(bookmarkManager.ensureGroupFolder).not.toHaveBeenCalled();
    expect(storage.updateMapping).not.toHaveBeenCalled();
  });

  it('accepts target group events during move window', async () => {
    engine.registerMoveGuard('Work', {
      sourceGroupId: 100,
      targetGroupId: 200,
      ttlMs: 10000,
    });

    await engine.handleGroupUpdated(makeGroup(200));

    expect(storage.updateMapping).toHaveBeenCalledWith('Work', expect.objectContaining({
      currentGroupId: '200',
      syncEnabled: true,
    }));
  });
});
