// Aggressive prefix-chain cleanup.
//
// For every folder under the container, if its title is a STRICT PREFIX of
// another folder's title in the same container, it's cruft.
//   - If cruft has bookmarks: union-merge its unique URLs into the longest
//     chain-partner with the most bookmarks (the likely "real" folder),
//     then delete.
//   - If cruft is empty: just delete.
//
// No confirmation, no dry-run — paste, run, done.

(async () => {
  const CONTAINER_ID = '21021';
  const subs = (await chrome.bookmarks.getChildren(CONTAINER_ID))
    .filter(c => !c.url);

  // Build title -> [folders] so we can break ties
  const all = subs.slice();

  // For each folder, find its prefix-superstrings (other folders whose title
  // starts with this one + at least one more char). If any exist, this is cruft.
  const supersOf = new Map(); // folderId -> [superstring folder object]
  for (const s of all) {
    const supers = all.filter(o =>
      o.title !== s.title &&
      o.title.startsWith(s.title) &&
      o.title.length > s.title.length
    );
    if (supers.length > 0) supersOf.set(s.id, supers);
  }

  const cruft = all.filter(s => supersOf.has(s.id));

  if (cruft.length === 0) {
    console.log('no prefix-chain cruft found');
    return;
  }

  // Fetch bookmark counts/URLs for everyone we'll touch
  const countsById = new Map();
  const urlsById = new Map();
  const touched = new Set();
  for (const c of cruft) {
    touched.add(c.id);
    for (const sup of supersOf.get(c.id)) touched.add(sup.id);
  }
  for (const id of touched) {
    const children = (await chrome.bookmarks.getChildren(id)).filter(x => x.url);
    countsById.set(id, children.length);
    urlsById.set(id, children);
  }

  let mergedUrls = 0;
  let deletedFolders = 0;

  for (const c of cruft) {
    const cBookmarks = urlsById.get(c.id) || [];
    if (cBookmarks.length > 0) {
      // Pick canonical among supersOf(c): longest title, tie-break by most bookmarks
      const candidates = supersOf.get(c.id).slice().sort((a, b) =>
        (b.title.length - a.title.length) ||
        ((countsById.get(b.id) || 0) - (countsById.get(a.id) || 0))
      );
      const canonical = candidates[0];
      const canonicalUrlSet = new Set((urlsById.get(canonical.id) || []).map(b => b.url));

      let movedHere = 0;
      for (const bm of cBookmarks) {
        if (!canonicalUrlSet.has(bm.url)) {
          await chrome.bookmarks.move(bm.id, { parentId: canonical.id });
          canonicalUrlSet.add(bm.url);
          movedHere++;
        }
      }
      mergedUrls += movedHere;
      console.log('merge',
        JSON.stringify(c.title), 'id=' + c.id,
        'into', JSON.stringify(canonical.title), 'id=' + canonical.id,
        'moved', movedHere, 'of', cBookmarks.length);
    }

    await chrome.bookmarks.removeTree(c.id);
    deletedFolders++;
  }

  console.log('done. merged', mergedUrls, 'URLs, deleted', deletedFolders, 'folders');
})();
