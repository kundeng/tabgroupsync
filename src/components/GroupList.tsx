import React from 'react';
import { Box, Typography } from '@mui/material';
import { Info as InfoIcon } from '@mui/icons-material';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncEngine } from '../lib/sync/syncEngine';
import { GroupViewModel } from '../lib/types/storage';
import GroupSection from './GroupSection';
import { Logger } from '../lib/utils/logger';
import { BookmarkManager } from '../lib/bookmarks/bookmarkManager';

interface GroupListProps {
  storage: StorageManager;
  syncEngine: SyncEngine;
  bookmarkManager: BookmarkManager;
}

export default function GroupList({ storage, syncEngine, bookmarkManager }: GroupListProps) {
  const [groups, setGroups] = React.useState<GroupViewModel[]>([]);
  const [parentFolder, setParentFolder] = React.useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const logger = Logger.getInstance();

  // Load groups helper
  const loadGroups = React.useCallback(async () => {
    try {
      // Get all tab groups from all windows
      const allGroups = await chrome.tabGroups.query({});
      const currentWindowId = await chrome.windows.getCurrent().then(w => w.id);
      const now = Date.now();

      // Get parent folder and its subfolders
      const parentResponse = await new Promise<{ folder: chrome.bookmarks.BookmarkTreeNode | null }>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_TAB_GROUPS_FOLDER' }, response => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      const parent = parentResponse.folder;
      if (!parent) {
        setGroups([]);
        return;
      }

      const folders = await chrome.bookmarks.getChildren(parent.id);
      const settingsResponse = await new Promise<{ settings: any }>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, response => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      const settings = settingsResponse.settings;

      const mappingsResponse = await new Promise<{ mappings: any }>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_ALL_MAPPINGS' }, response => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      const runtimeMappings = mappingsResponse.mappings;
      
      logger.info('groups:loading', {
        allGroups: allGroups.map(g => ({ id: g.id, title: g.title })),
        folders: folders.map(f => ({ id: f.id, title: f.title })),
        runtimeMappings
      });

      // Build view models from current groups
      const viewModels: GroupViewModel[] = allGroups.map(group => {
        const name = group.title || 'Unnamed Group';
        const mapping = runtimeMappings[name];
        const folder = folders.find(f => f.title === name);
        const isCurrentWindow = group.windowId === currentWindowId;

        return {
          id: group.id.toString(),
          name,
          color: group.color,
          windowId: group.windowId,
          isCurrentWindow,
          isActive: true,
          lastSeen: now,
          syncEnabled: mapping?.syncEnabled ?? (settings.autoSync && !!folder),
          status: mapping?.status ?? {
            lastSynced: 0,
            inProgress: false
          },
          folder,
          inactiveFor: 0
        };
      });

      // Add folders without active groups
      folders.forEach(folder => {
        if (!viewModels.some(vm => vm.name === folder.title)) {
          const mapping = runtimeMappings[folder.title];
          viewModels.push({
            id: `inactive-${folder.id}`,
            name: folder.title,
            isCurrentWindow: false,
            isActive: false,
            lastSeen: now,
            syncEnabled: mapping?.syncEnabled ?? true,
            status: mapping?.status ?? {
              lastSynced: 0,
              inProgress: false
            },
            folder,
            inactiveFor: 0
          });
        }
      });

      logger.info('groups:loaded', {
        viewModels: viewModels.map(vm => ({
          name: vm.name,
          syncEnabled: vm.syncEnabled,
          isCurrentWindow: vm.isCurrentWindow,
          folder: vm.folder?.title
        }))
      });

      setGroups(viewModels);
    } catch (error) {
      logger.error('groupList:loadFailed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [logger]);

  // Load parent folder and groups
  React.useEffect(() => {
    const loadParentFolder = async () => {
      try {
        const response = await new Promise<{ folder: chrome.bookmarks.BookmarkTreeNode | null }>(resolve => {
          chrome.runtime.sendMessage({ type: 'GET_TAB_GROUPS_FOLDER' }, resolve);
        });
        setParentFolder(response.folder);
        // Load groups after parent folder is loaded
        await loadGroups();
      } catch (error) {
        logger.error('groupList:loadTabGroupsFolderFailed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    };
    loadParentFolder();

    // Set up listeners for group changes and storage changes
    const handleChange = () => loadGroups();
    chrome.tabGroups.onCreated.addListener(handleChange);
    chrome.tabGroups.onUpdated.addListener(handleChange);
    chrome.tabGroups.onRemoved.addListener(handleChange);
    chrome.storage.onChanged.addListener(handleChange);

    return () => {
      chrome.tabGroups.onCreated.removeListener(handleChange);
      chrome.tabGroups.onUpdated.removeListener(handleChange);
      chrome.tabGroups.onRemoved.removeListener(handleChange);
      chrome.storage.onChanged.removeListener(handleChange);
    };
  }, [logger, loadGroups]);

  const handleToggleSync = async (name: string) => {
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'TOGGLE_SYNC', name }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.success);
          }
        });
      });
      
      logger.info('sync:toggled', { name });
      await loadGroups(); // Refresh groups to show updated state
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('sync:toggleFailed', {
        name,
        error: message
      });
      await loadGroups(); // Refresh groups to show original state
      throw error; // Re-throw to let GroupSection handle the error
    }
  };

  const handleFullResync = async (group: GroupViewModel) => {
    try {
      const currentGroup = await chrome.tabGroups.get(parseInt(group.id));
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'FULL_RESYNC_GROUP', group: currentGroup }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.success);
          }
        });
      });

      logger.info('sync:fullResync:completed', { name: group.name });
      await loadGroups(); // Refresh UI after sync
    } catch (error) {
      logger.error('sync:fullResync:failed', {
        name: group.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  // Group the tab groups by category
  const currentWindowGroups = groups.filter(g => g.isCurrentWindow);
  const otherWindowGroups = groups.filter(g => !g.isCurrentWindow && g.windowId);
  const inactiveGroups = groups.filter(g => !g.windowId);

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Tab Groups
      </Typography>

      {currentWindowGroups.length > 0 && (
        <GroupSection
          title="Current Window"
          groups={currentWindowGroups}
          storage={storage}
          parentFolder={parentFolder}
          onToggleSync={handleToggleSync}
          onFullResync={handleFullResync}
        />
      )}

      {otherWindowGroups.length > 0 && (
        <GroupSection
          title="Other Windows"
          groups={otherWindowGroups}
          storage={storage}
          parentFolder={parentFolder}
          onToggleSync={handleToggleSync}
          onFullResync={handleFullResync}
          disabled
        />
      )}

      {inactiveGroups.length > 0 && (
        <GroupSection
          title="Previously Synced"
          groups={inactiveGroups}
          storage={storage}
          parentFolder={parentFolder}
          onToggleSync={handleToggleSync}
          onFullResync={handleFullResync}
        />
      )}

      {groups.length === 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
          <InfoIcon fontSize="small" />
          <Typography variant="body2">
            No tab groups found. Create a tab group to start backing up.
          </Typography>
        </Box>
      )}

      <Box sx={{ mt: 2, color: 'text.secondary' }}>
        <Typography variant="caption" component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <InfoIcon fontSize="small" />
          Enable sync for each group to back up tabs to bookmarks. Bookmarks are preserved even when tabs are closed.
        </Typography>
      </Box>
    </Box>
  );
}
