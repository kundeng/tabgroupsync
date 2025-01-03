import React from 'react';
import { Box, Typography } from '@mui/material';
import { Info as InfoIcon } from '@mui/icons-material';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncEngine } from '../lib/sync/syncEngine';
import { GroupViewModel, GroupState } from '../lib/types/storage';
import GroupSection from './GroupSection';
import { Logger } from '../lib/utils/logger';

interface GroupListProps {
  storage: StorageManager;
  syncEngine: SyncEngine;
}

export default function GroupList({ storage, syncEngine }: GroupListProps) {
  const [groups, setGroups] = React.useState<GroupViewModel[]>([]);
  const logger = Logger.getInstance();

  // Load all groups and their states
  React.useEffect(() => {
    const loadGroups = async () => {
      try {
        // Get all tab groups from all windows
        const allGroups = await chrome.tabGroups.query({});
        const currentWindowId = await chrome.windows.getCurrent().then(w => w.id);
        const now = Date.now();

        // Get stored state
        const state = await storage.getState();
        
        // Build view models from all current groups
        const viewModels: GroupViewModel[] = allGroups.map(group => {
          const stored = state.groups[group.id.toString()];
          const isCurrentWindow = group.windowId === currentWindowId;

          return {
            id: group.id.toString(),
            name: group.title || 'Unnamed Group',
            color: group.color,
            windowId: group.windowId,
            isCurrentWindow,
            isActive: true,
            isArchived: stored?.archived || false,
            lastSeen: now,
            syncEnabled: stored?.syncEnabled ?? true,
            status: stored?.status || {
              lastSynced: 0,
              inProgress: false
            },
            inactiveFor: 0
          };
        });

        // Add stored groups that aren't currently active
        Object.values(state.groups).forEach((stored: GroupState) => {
          if (!viewModels.some(vm => vm.id === stored.id) && !stored.archived) {
            viewModels.push({
              id: stored.id,
              name: stored.name,
              color: stored.color,
              windowId: stored.windowId,
              isCurrentWindow: false,
              isActive: false,
              isArchived: stored.archived,
              lastSeen: stored.lastSeen,
              syncEnabled: stored.syncEnabled,
              status: stored.status,
              inactiveFor: Math.floor((now - stored.lastSeen) / (1000 * 60 * 60 * 24))
            });
          }
        });

        // Add archived groups
        Object.values(state.groups)
          .filter(stored => stored.archived)
          .forEach((stored: GroupState) => {
            if (!viewModels.some(vm => vm.id === stored.id)) {
              viewModels.push({
                id: stored.id,
                name: stored.name,
                color: stored.color,
                windowId: stored.windowId,
                isCurrentWindow: false,
                isActive: false,
                isArchived: true,
                lastSeen: stored.lastSeen,
                syncEnabled: stored.syncEnabled,
                status: stored.status,
                inactiveFor: Math.floor((now - stored.lastSeen) / (1000 * 60 * 60 * 24))
              });
            }
          });

        setGroups(viewModels);
      } catch (error) {
        logger.error('groupList:loadFailed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    };

    loadGroups();

    // Set up listeners for group changes
    const handleGroupChange = () => loadGroups();
    chrome.tabGroups.onCreated.addListener(handleGroupChange);
    chrome.tabGroups.onUpdated.addListener(handleGroupChange);
    chrome.tabGroups.onRemoved.addListener(handleGroupChange);

    return () => {
      chrome.tabGroups.onCreated.removeListener(handleGroupChange);
      chrome.tabGroups.onUpdated.removeListener(handleGroupChange);
      chrome.tabGroups.onRemoved.removeListener(handleGroupChange);
    };
  }, [storage, logger]);

  const handleToggleSync = async (groupId: string, enabled: boolean) => {
    try {
      await syncEngine.setGroupSyncEnabled(groupId, enabled);
      logger.info('sync:toggled', { groupId, enabled });
    } catch (error) {
      logger.error('sync:toggleFailed', {
        groupId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const handleFullResync = async (group: GroupViewModel) => {
    try {
      const currentGroup = await chrome.tabGroups.get(parseInt(group.id));
      await syncEngine.fullResyncGroup(currentGroup);
      logger.info('sync:fullResync:completed', { groupId: group.id });
    } catch (error) {
      logger.error('sync:fullResync:failed', {
        groupId: group.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const handleArchive = async (group: GroupViewModel) => {
    try {
      await storage.updateGroup(group.id, { archived: true });
      logger.info('group:archived', { groupId: group.id });
    } catch (error) {
      logger.error('group:archive:failed', {
        groupId: group.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const handleRestore = async (group: GroupViewModel) => {
    try {
      await storage.updateGroup(group.id, { archived: false });
      logger.info('group:restored', { groupId: group.id });
    } catch (error) {
      logger.error('group:restore:failed', {
        groupId: group.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const handleDelete = async (group: GroupViewModel) => {
    try {
      await storage.removeGroup(group.id);
      logger.info('group:deleted', { groupId: group.id });
    } catch (error) {
      logger.error('group:delete:failed', {
        groupId: group.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  // Group the tab groups by category
  const currentWindowGroups = groups.filter(g => g.isCurrentWindow && !g.isArchived);
  const otherWindowGroups = groups.filter(g => !g.isCurrentWindow && !g.isArchived && g.windowId);
  const inactiveGroups = groups.filter(g => !g.windowId && !g.isArchived);
  const archivedGroups = groups.filter(g => g.isArchived);

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
          onToggleSync={handleToggleSync}
          onFullResync={handleFullResync}
          onArchive={handleArchive}
        />
      )}

      {otherWindowGroups.length > 0 && (
        <GroupSection
          title="Other Windows"
          groups={otherWindowGroups}
          storage={storage}
          onToggleSync={handleToggleSync}
          onFullResync={handleFullResync}
          onArchive={handleArchive}
          disabled
        />
      )}

      {inactiveGroups.length > 0 && (
        <GroupSection
          title="Previously Synced"
          groups={inactiveGroups}
          storage={storage}
          onToggleSync={handleToggleSync}
          onFullResync={handleFullResync}
          onArchive={handleArchive}
        />
      )}

      {archivedGroups.length > 0 && (
        <GroupSection
          title="Archived"
          groups={archivedGroups}
          storage={storage}
          onToggleSync={handleToggleSync}
          onFullResync={handleFullResync}
          onRestore={handleRestore}
          onDelete={handleDelete}
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
          Changes to tab groups are automatically backed up to bookmarks. Bookmarks are never deleted when tabs are closed.
        </Typography>
      </Box>
    </Box>
  );
}
