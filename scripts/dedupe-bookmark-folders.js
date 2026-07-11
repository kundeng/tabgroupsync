// Consolidate duplicate-title bookmark folders under the container.
//
// Usage:
//   1. chrome://extensions -> Tab Group Sync -> "service worker" -> Console
//   2. If multi-line paste blocked: type `allow pasting` and Enter
//   3. Open this file in your editor, copy ALL, paste, Enter
//
// Behavior per duplicate group (same title >= 2 times):
//   - canonical = folder with most bookmark children (tie-break: oldest)
//   - unique URLs from losers are moved into canonical
//   - loser folders are then deleted (only dupes remain in them by then)
//
// Container folder id defaults to '21021' (the "Tab Group Bookmarks" id
// shown in your earlier inspection). Edit below if yours differs.

(async () => {
  const CONTAINER_ID = '21021';

  const subs = (await chrome.bookmarks.getChildren(CONTAINER_ID))
    .filter(c => !c.url);

  const byTitle = new Map();
  for (const s of subs) {
    if (!byTitle.has(s.title)) byTitle.set(s.title, []);
    byTitle.get(s.title).push(s);
  }

  let mergedUrls = 0;
  let deletedFolders = 0;

  for (const [title, folders] of byTitle) {
    if (folders.length < 2) continue;

    const withCounts = await Promise.all(folders.map(async f => ({
      folder: f,
      bookmarks: (await chrome.bookmarks.getChildren(f.id)).filter(c => c.url),
    })));

    withCounts.sort((a, b) =>
      (b.bookmarks.length - a.bookmarks.length) ||
      ((a.folder.dateAdded || 0) - (b.folder.dateAdded || 0))
    );

    const canonical = withCounts[0];
    const losers = withCounts.slice(1);
    const canonicalUrls = new Set(canonical.bookmarks.map(b => b.url));

    for (const loser of losers) {
      let movedHere = 0;
      for (const bm of loser.bookmarks) {
        if (!canonicalUrls.has(bm.url)) {
          await chrome.bookmarks.move(bm.id, { parentId: canonical.folder.id });
          canonicalUrls.add(bm.url);
          mergedUrls++;
          movedHere++;
        }
      }
      await chrome.bookmarks.removeTree(loser.folder.id);
      deletedFolders++;
      console.log(
        title,
        'loser id=' + loser.folder.id,
        'had', loser.bookmarks.length, 'bookmarks,',
        'moved', movedHere, 'unique URLs,',
        'folder removed.'
      );
    }
  }

  console.log('done. merged', mergedUrls, 'urls, deleted', deletedFolders, 'folders');
})();
