import React from 'react';
import {
  Box,
  InputBase,
  Typography,
  Chip,
  Collapse,
} from '@mui/material';
import {
  Search as SearchIcon,
  Tab as TabIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  OpenInNew as OpenIcon,
} from '@mui/icons-material';
import uFuzzy from '@leeoniya/ufuzzy';
import { localize } from '../lib/utils/pathMapper';

interface SearchResult {
  url: string;
  title: string;
  groupName: string;
  groupColor?: string;
  inTab: boolean;
  inBookmark: boolean;
  isFile: boolean;
  tabId?: number;
}

const uf = new uFuzzy({ intraMode: 1 });

export default function SearchBar() {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [allItems, setAllItems] = React.useState<SearchResult[]>([]);
  const [haystack, setHaystack] = React.useState<string[]>([]);
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (!focused) return;
    let cancelled = false;

    (async () => {
      const [tabs, tabGroups] = await Promise.all([
        chrome.tabs.query({}),
        chrome.tabGroups.query({})
      ]);

      const groupMap: Record<number, { title: string; color: string }> = {};
      for (const g of tabGroups) {
        groupMap[g.id] = { title: g.title || '', color: g.color || 'grey' };
      }

      const items: SearchResult[] = [];
      const seen = new Set<string>();

      for (const tab of tabs) {
        if (!tab.url || tab.groupId === -1 || !groupMap[tab.groupId]) continue;
        const key = tab.url;
        seen.add(key);
        items.push({
          url: tab.url,
          title: tab.title || '',
          groupName: groupMap[tab.groupId].title,
          groupColor: groupMap[tab.groupId].color,
          inTab: true,
          inBookmark: false,
          isFile: tab.url.startsWith('file://'),
          tabId: tab.id,
        });
      }

      const tree = await chrome.bookmarks.getTree();
      function findTGB(nodes: chrome.bookmarks.BookmarkTreeNode[]): chrome.bookmarks.BookmarkTreeNode | null {
        for (const n of nodes) {
          if (n.title === 'Tab Group Bookmarks' && !n.url) return n;
          if (n.children) { const f = findTGB(n.children); if (f) return f; }
        }
        return null;
      }

      const tgb = findTGB(tree);
      if (tgb) {
        const groups = await chrome.bookmarks.getChildren(tgb.id);
        for (const group of groups) {
          if (group.url) continue;
          const bms = await chrome.bookmarks.getChildren(group.id);
          for (const bm of bms) {
            if (!bm.url) continue;
            if (seen.has(bm.url)) {
              const existing = items.find(i => i.url === bm.url);
              if (existing) existing.inBookmark = true;
              continue;
            }
            seen.add(bm.url);
            items.push({
              url: bm.url,
              title: bm.title || '',
              groupName: group.title,
              inTab: false,
              inBookmark: true,
              isFile: bm.url.startsWith('file://'),
            });
          }
        }
      }

      if (!cancelled) {
        setAllItems(items);
        setHaystack(items.map(i => `${i.title} ${i.url} ${i.groupName}`));
      }
    })();

    return () => { cancelled = true; };
  }, [focused]);

  React.useEffect(() => {
    if (!query.trim() || allItems.length === 0) {
      setResults([]);
      return;
    }

    const idxs = uf.filter(haystack, query);
    if (!idxs || idxs.length === 0) {
      setResults([]);
      return;
    }

    const info = uf.info(idxs, haystack, query);
    const order = uf.sort(info, haystack, query);
    const sorted = order.map(i => allItems[idxs[i]]).filter(Boolean);
    setResults(sorted.slice(0, 30));
  }, [query, allItems, haystack]);

  const handleClick = async (item: SearchResult) => {
    if (item.inTab && item.tabId) {
      await chrome.tabs.update(item.tabId, { active: true });
      const tab = await chrome.tabs.get(item.tabId);
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    } else {
      const [syncData, localData] = await Promise.all([
        chrome.storage.sync.get('state:pathMappings'),
        chrome.storage.local.get('machineId')
      ]);
      const store = syncData['state:pathMappings'] as any;
      const mid = localData.machineId as string;
      const rules = (store?.machines?.[mid]?.rules || []) as Array<{canonicalPrefix: string; localPrefix: string}>;

      const resolved = item.isFile ? localize(item.url, { machineId: '', rules }) : item.url;
      await chrome.tabs.create({ url: resolved, active: true });
    }
  };

  const colorMap: Record<string, string> = {
    grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00',
    green: '#1e8e3e', pink: '#e91e63', purple: '#a142f4', cyan: '#00897b', orange: '#e8710a',
  };

  const grouped = React.useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const r of results) {
      const arr = map.get(r.groupName) || [];
      arr.push(r);
      map.set(r.groupName, arr);
    }
    return map;
  }, [results]);

  const showResults = focused && query.trim().length > 0;

  return (
    <Box sx={{ position: 'relative', mb: 1 }}>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          border: '1px solid', borderColor: focused ? 'primary.main' : 'divider',
          borderRadius: 1, px: 1.5, py: 0.5,
          transition: 'border-color 0.2s',
        }}
      >
        <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <InputBase
          placeholder="Search bookmarks & tabs..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          sx={{ flex: 1, fontSize: '0.85rem' }}
          fullWidth
        />
      </Box>

      <Collapse in={showResults}>
        <Box
          sx={{
            position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 10,
            bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
            borderRadius: 1, mt: 0.5, maxHeight: 350, overflowY: 'auto',
            boxShadow: 3,
          }}
        >
          {results.length === 0 && (
            <Typography variant="caption" sx={{ p: 2, display: 'block', color: 'text.secondary' }}>
              No results for "{query}"
            </Typography>
          )}

          {Array.from(grouped.entries()).map(([groupName, items]) => (
            <Box key={groupName}>
              <Box sx={{ px: 1.5, pt: 1, pb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{
                  width: 8, height: 8, borderRadius: '50%',
                  bgcolor: colorMap[items[0]?.groupColor || 'grey'] || colorMap.grey,
                }} />
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {groupName}
                </Typography>
              </Box>

              {items.map((item, i) => (
                <Box
                  key={`${item.url}-${i}`}
                  onMouseDown={() => handleClick(item)}
                  sx={{
                    px: 1.5, py: 0.75, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 1,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontSize: '0.82rem', fontWeight: 500 }}>
                      {item.title}
                    </Typography>
                    <Typography variant="caption" noWrap sx={{ color: 'text.secondary', fontSize: '0.7rem', display: 'block' }}>
                      {item.isFile
                        ? decodeURIComponent(item.url.replace('file://', ''))
                        : item.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                    {item.inTab && item.inBookmark && (
                      <Chip label="synced" size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                    )}
                    {item.inTab && !item.inBookmark && (
                      <Chip icon={<TabIcon sx={{ fontSize: '12px !important' }} />} label="tab" size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                    )}
                    {!item.inTab && item.inBookmark && (
                      <Chip icon={<FolderIcon sx={{ fontSize: '12px !important' }} />} label="saved" size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                    )}
                    {item.isFile && (
                      <Chip icon={<FileIcon sx={{ fontSize: '12px !important' }} />} label="file" size="small" color="info" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
