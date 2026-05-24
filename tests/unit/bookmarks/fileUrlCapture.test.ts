import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookmarkManager } from '../../../src/lib/bookmarks/bookmarkManager';
import { StorageManager } from '../../../src/lib/storage/storageManager';

describe('BookmarkManager file:// URL capture', () => {
  let bookmarkManager: BookmarkManager;
  let storageManager: StorageManager;
  let createdBookmarks: Array<{ title: string; url: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    createdBookmarks = [];

    storageManager = new StorageManager();

    vi.mocked(chrome.storage.sync.get).mockImplementation((_keys: any, callback: any) => {
      if (callback) {
        callback({
          'state:settings': {
            containerFolderId: 'container-1',
            autoSync: true,
            keepRemoved: true,
            cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: true, deleteThreshold: 90 }
          }
        });
      }
      return Promise.resolve({
        'state:settings': {
          containerFolderId: 'container-1',
          autoSync: true,
          keepRemoved: true,
          cleanup: { enabled: false, inactiveThreshold: 30, autoArchive: true, deleteThreshold: 90 }
        }
      });
    });

    vi.mocked(chrome.storage.sync.set).mockImplementation((_items: any, callback?: any) => {
      if (callback) callback();
      return Promise.resolve();
    });

    vi.mocked(chrome.storage.local.get).mockImplementation((_keys: any) => {
      return Promise.resolve({});
    });

    vi.mocked(chrome.bookmarks.get).mockImplementation((id: any) => {
      return Promise.resolve([{
        id: typeof id === 'string' ? id : id[0],
        title: 'Test Folder',
        parentId: 'container-1',
        index: 0,
        dateAdded: Date.now(),
      }]);
    });

    vi.mocked(chrome.bookmarks.getChildren).mockImplementation((_id: string) => {
      return Promise.resolve([]);
    });

    vi.mocked(chrome.bookmarks.create).mockImplementation((details: any) => {
      createdBookmarks.push({ title: details.title, url: details.url });
      return Promise.resolve({
        id: `bm-${createdBookmarks.length}`,
        title: details.title,
        url: details.url,
        parentId: details.parentId,
        index: 0,
        dateAdded: Date.now(),
      });
    });

    bookmarkManager = new BookmarkManager(storageManager);
  });

  function makeTabs(urls: string[]): chrome.tabs.Tab[] {
    return urls.map((url, i) => ({
      id: i + 1,
      index: i,
      windowId: 1,
      highlighted: false,
      active: false,
      pinned: false,
      incognito: false,
      url,
      title: `Tab ${i}`,
      groupId: 1,
    }));
  }

  it('includes file:// URLs in sync', async () => {
    const tabs = makeTabs([
      'https://example.com',
      'file:///home/user/doc.pdf',
    ]);

    await bookmarkManager.syncGroupToFolder('test', tabs, 'folder-1');

    expect(createdBookmarks).toHaveLength(2);
    expect(createdBookmarks[0].url).toBe('https://example.com');
    expect(createdBookmarks[1].url).toBe('file:///home/user/doc.pdf');
  });

  it('filters browser-internal URLs but keeps file://', async () => {
    const tabs = makeTabs([
      'file:///home/user/doc.pdf',
      'chrome://extensions',
      'edge://settings',
      'about:blank',
      'https://example.com',
    ]);

    await bookmarkManager.syncGroupToFolder('test', tabs, 'folder-1');

    expect(createdBookmarks).toHaveLength(2);
    const urls = createdBookmarks.map(b => b.url);
    expect(urls).toContain('file:///home/user/doc.pdf');
    expect(urls).toContain('https://example.com');
    expect(urls).not.toContain('chrome://extensions');
  });

  it('uses filename as title for file:// tabs without titles', async () => {
    const tabs: chrome.tabs.Tab[] = [{
      id: 1, index: 0, windowId: 1, highlighted: false,
      active: false, pinned: false, incognito: false,
      url: 'file:///home/user/MPlus_Tutorial.pdf',
      title: '',
      groupId: 1,
    }];

    await bookmarkManager.syncGroupToFolder('test', tabs, 'folder-1');

    expect(createdBookmarks).toHaveLength(1);
    expect(createdBookmarks[0].title).toBe('MPlus_Tutorial.pdf');
  });

  it('deduplicates file:// URLs against existing bookmarks', async () => {
    vi.mocked(chrome.bookmarks.getChildren).mockImplementation((_id: string) => {
      return Promise.resolve([{
        id: 'existing-1',
        title: 'Existing',
        url: 'file:///home/user/doc.pdf',
        parentId: 'folder-1',
        index: 0,
        dateAdded: Date.now(),
      }]);
    });

    const tabs = makeTabs(['file:///home/user/doc.pdf']);
    await bookmarkManager.syncGroupToFolder('test', tabs, 'folder-1');

    expect(createdBookmarks).toHaveLength(0);
  });
});
