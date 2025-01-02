import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Switch,
  IconButton,
  Tooltip,
  CircularProgress,
  Button,
  Divider,
} from '@mui/material';
import {
  Sync as SyncIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import SnapshotList from './SnapshotList';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncEngine } from '../lib/sync/syncEngine';
import { GroupFolderMapping } from '../lib/types/storage';

interface GroupListProps {
  storage: StorageManager;
  syncEngine: SyncEngine;
}

interface TabGroupWithMapping extends chrome.tabGroups.TabGroup {
  mapping?: GroupFolderMapping;
  syncEnabled?: boolean;
}

export default function GroupList({ storage, syncEngine }: GroupListProps) {
  const [groups, setGroups] = React.useState<TabGroupWithMapping[]>([]);
  const [syncing, setSyncing] = React.useState<Record<number, boolean>>({});

  // Load groups and their sync states
  React.useEffect(() => {
    const loadGroups = async () => {
      // Get all tab groups
      chrome.tabGroups.query({}, async (groups) => {
        // Get sync state for each group
        const groupsWithState = await Promise.all(groups.map(async (group) => ({
          ...group,
          syncEnabled: await syncEngine.getGroupSyncEnabled(group.id.toString()),
        })));

        setGroups(groupsWithState);
      });
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
  }, [storage, syncEngine]);

  const handleSyncToggle = async (groupId: number) => {
    const newState = !groups.find(g => g.id === groupId)?.syncEnabled;
    await syncEngine.setGroupSyncEnabled(groupId.toString(), newState);
    
    // Refresh groups to update UI
    chrome.tabGroups.query({}, async (groups) => {
      const groupsWithState = await Promise.all(groups.map(async (group) => ({
        ...group,
        syncEnabled: await syncEngine.getGroupSyncEnabled(group.id.toString()),
      })));
      setGroups(groupsWithState);
    });
  };

  const handleFullResync = async (group: chrome.tabGroups.TabGroup) => {
    setSyncing(prev => ({ ...prev, [group.id]: true }));
    try {
      await syncEngine.fullResyncGroup(group);
    } finally {
      setSyncing(prev => ({ ...prev, [group.id]: false }));
    }
  };

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Tab Groups
      </Typography>

      <List>
        {groups.map((group) => (
          <ListItem
            key={group.id}
            sx={{
              borderLeft: `4px solid ${group.color}`,
              bgcolor: 'background.paper',
              mb: 1,
              borderRadius: 1,
            }}
          >
            <ListItemText
              primary={group.title || 'Unnamed Group'}
              secondary={
                <Typography variant="caption" color="text.secondary">
                  {group.syncEnabled ? 'Backing up to bookmarks' : 'Sync paused'}
                </Typography>
              }
            />
            <>
              <ListItemSecondaryAction sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SnapshotList
                  storage={storage}
                  groupId={group.id.toString()}
                  groupName={group.title || 'Unnamed Group'}
                />
                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
                <Tooltip title="Full resync (replaces all bookmarks)">
                  <IconButton
                    edge="end"
                    onClick={() => handleFullResync(group)}
                    disabled={!group.syncEnabled || syncing[group.id]}
                  >
                    {syncing[group.id] ? (
                      <CircularProgress size={20} />
                    ) : (
                      <RefreshIcon />
                    )}
                  </IconButton>
                </Tooltip>
                <Tooltip title={group.syncEnabled ? 'Pause backup' : 'Resume backup'}>
                  <Switch
                    edge="end"
                    checked={group.syncEnabled ?? false}
                    onChange={() => handleSyncToggle(group.id)}
                  />
                </Tooltip>
              </ListItemSecondaryAction>
            </>
          </ListItem>
        ))}
      </List>

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
