import { Logger } from '../utils/logger';
import { StorageManager } from '../storage/storageManager';

export interface CruftCandidate {
  id: string;
  title: string;
  bookmarkCount: number;
  mergeTargetId: string;
  mergeTargetTitle: string;
}

export interface CruftScanResult {
  candidates: CruftCandidate[];
  containerFolderId: string;
}

export async function scanPrefixCruft(storage: StorageManager): Promise<CruftScanResult | null> {
  const logger = Logger.getInstance();

  const settings = await storage.getSettings();
  if (!settings.containerFolderId) return null;

  const containerChildren = await chrome.bookmarks.getChildren(settings.containerFolderId);
  const bookmarksFolder = containerChildren.find(c => !c.url && c.title === 'Tab Group Bookmarks');
  if (!bookmarksFolder) return null;

  const subs = (await chrome.bookmarks.getChildren(bookmarksFolder.id)).filter(c => !c.url);

  const supersOf = new Map<string, chrome.bookmarks.BookmarkTreeNode[]>();
  for (const s of subs) {
    const supers = subs.filter(o =>
      o.title !== s.title &&
      o.title.startsWith(s.title) &&
      o.title.length > s.title.length
    );
    if (supers.length > 0) supersOf.set(s.id, supers);
  }

  const cruft = subs.filter(s => supersOf.has(s.id));
  if (cruft.length === 0) return { candidates: [], containerFolderId: bookmarksFolder.id };

  const candidates: CruftCandidate[] = [];

  for (const c of cruft) {
    const cChildren = (await chrome.bookmarks.getChildren(c.id)).filter(x => x.url);

    const supers = supersOf.get(c.id)!;
    const withCounts = await Promise.all(supers.map(async s => ({
      node: s,
      count: (await chrome.bookmarks.getChildren(s.id)).filter(x => x.url).length,
    })));
    withCounts.sort((a, b) =>
      (b.node.title.length - a.node.title.length) ||
      (b.count - a.count)
    );
    const target = withCounts[0].node;

    candidates.push({
      id: c.id,
      title: c.title,
      bookmarkCount: cChildren.length,
      mergeTargetId: target.id,
      mergeTargetTitle: target.title,
    });
  }

  logger.info('cleanup:scan', { candidateCount: candidates.length });
  return { candidates, containerFolderId: bookmarksFolder.id };
}

export async function executePrefixCruftCleanup(
  candidates: CruftCandidate[]
): Promise<{ mergedUrls: number; deletedFolders: number }> {
  const logger = Logger.getInstance();
  let mergedUrls = 0;
  let deletedFolders = 0;

  for (const c of candidates) {
    const cBookmarks = (await chrome.bookmarks.getChildren(c.id)).filter(x => x.url);

    if (cBookmarks.length > 0) {
      const targetBookmarks = (await chrome.bookmarks.getChildren(c.mergeTargetId)).filter(x => x.url);
      const targetUrls = new Set(targetBookmarks.map(b => b.url));

      for (const bm of cBookmarks) {
        if (!targetUrls.has(bm.url)) {
          await chrome.bookmarks.move(bm.id, { parentId: c.mergeTargetId });
          targetUrls.add(bm.url);
          mergedUrls++;
        }
      }
    }

    try {
      await chrome.bookmarks.removeTree(c.id);
      deletedFolders++;
    } catch (err) {
      logger.warn('cleanup:removeFailed', {
        id: c.id, title: c.title,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  logger.info('cleanup:executed', { mergedUrls, deletedFolders });
  return { mergedUrls, deletedFolders };
}
