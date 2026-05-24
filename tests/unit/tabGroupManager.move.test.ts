import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TabGroupManager } from '../../src/lib/tabGroupManager';

describe('TabGroupManager.moveGroupToWindow', () => {
  let syncEngine: any;
  let storage: any;
  let manager: TabGroupManager;

  beforeEach(() => {
    vi.clearAllMocks();

    syncEngine = {
      registerMoveGuard: vi.fn(),
      queueGroupSync: vi.fn(),
    };

    storage = {
      getMapping: vi.fn().mockResolvedValue({
        name: 'Work',
        folderId: 'folder-1',
        currentGroupId: '11',
        syncEnabled: true,
        status: { lastSynced: 0, inProgress: false },
      }),
      updateMapping: vi.fn().mockResolvedValue(undefined),
    };

    manager = new TabGroupManager(syncEngine, storage);

    vi.mocked(chrome.tabGroups.get).mockImplementation((groupId: number, callback?: (group: chrome.tabGroups.TabGroup) => void) => {
      const group = {
        id: groupId,
        title: 'Work',
        color: 'blue',
        windowId: 1,
        collapsed: false,
      } as chrome.tabGroups.TabGroup;
      if (callback) callback(group);
      return Promise.resolve(group);
    });

    vi.mocked(chrome.tabs.query).mockImplementation((queryInfo: chrome.tabs.QueryInfo, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
      if (queryInfo.groupId === 11) {
        const result = [
          { id: 101, index: 2, windowId: 1, groupId: 11, url: 'https://example.com/a' },
          { id: 102, index: 0, windowId: 1, groupId: 11, url: 'https://example.com/b' },
        ] as chrome.tabs.Tab[];
        if (callback) callback(result);
        return Promise.resolve(result);
      }
      if (callback) callback([]);
      return Promise.resolve([]);
    });

    vi.mocked(chrome.tabs.move).mockImplementation(async () => [
      { id: 101, index: 0, windowId: 2, groupId: -1, url: 'https://example.com/a' },
      { id: 102, index: 1, windowId: 2, groupId: -1, url: 'https://example.com/b' },
    ] as chrome.tabs.Tab[]);

    vi.mocked(chrome.tabs.group).mockResolvedValue(22);
    vi.mocked(chrome.tabGroups.update).mockResolvedValue({
      id: 22,
      title: 'Work',
      color: 'blue',
      windowId: 2,
      collapsed: false,
    } as chrome.tabGroups.TabGroup);
  });

  it('moves tabs, recreates the group, and updates mapping with move guard', async () => {
    const result = await manager.moveGroupToWindow({
      sourceGroupId: 11,
      sourceGroupName: 'Work',
      targetWindowId: 2,
    });

    expect(chrome.tabs.move).toHaveBeenCalledWith([102, 101], { windowId: 2, index: -1 });
    expect(chrome.tabs.group).toHaveBeenCalledWith({ tabIds: [101, 102], createProperties: { windowId: 2 } });
    expect(syncEngine.registerMoveGuard).toHaveBeenCalledWith('Work', expect.objectContaining({
      sourceGroupId: 11,
      targetGroupId: 22,
    }));
    expect(storage.updateMapping).toHaveBeenCalledWith('Work', expect.objectContaining({
      currentGroupId: '22',
      syncEnabled: true,
    }));
    expect(result).toEqual({ targetGroupId: 22, movedTabCount: 2 });
  });
});
