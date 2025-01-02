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
} from '@mui/material';
import {
  Sync as SyncIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncEngine } from '../lib/sync/syncEngine';
import { GroupFolderMapping } from '../lib/types/storage';

interface GroupListProps {
  storage: StorageManager;
  syncEngine: SyncEngine;
}

interface TabGroupWithMapping extends chrome.tabGroups.TabGroup {
  mapping?: GroupFolderMapping;
}

export default function GroupList({ storage, syncEngine }: GroupListProps) {
  const [groups, setGroups] = React.useState<TabGroupWithMapping[]>([]);
  const [mappings, setMappings] = React.useState<Record<number, GroupFolderMapping>>({});

  // Load groups and their mappings
  React.useEffect(() => {
    const loadGroups = async () => {
      // Get all tab groups
      chrome.tabGroups.query({}, async (groups) => {
        const mappings = await storage.getAllMappings();
        setMappings(mappings);
        
        // Combine groups with their mappings
        const groupsWithMappings = groups.map(group => ({
          ...group,
          mapping: mappings[group.id]
        }));
        
        setGroups(groupsWithMappings);
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
  }, [storage]);

  const handleSyncToggle = async (groupId: number) => {
    await syncEngine.toggleSync(groupId);
    const newMappings = await storage.getAllMappings();
    setMappings(newMappings);
  };

  const getSyncStatus = (group: TabGroupWithMapping) => {
    if (!group.mapping) return null;
    
    if (group.mapping.status.inProgress) {
      return (
        <CircularProgress size={20} />
      );
    }

    if (group.mapping.status.error) {
      return (
        <Tooltip title={group.mapping.status.error}>
          <ErrorIcon color="error" />
        </Tooltip>
      );
    }

    if (group.mapping.syncEnabled) {
      return (
        <Tooltip title={`Last synced: ${new Date(group.mapping.status.lastSynced).toLocaleString()}`}>
          <SyncIcon color="primary" />
        </Tooltip>
      );
    }

    return null;
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
                group.mapping?.status.error ? (
                  <Typography variant="caption" color="error">
                    {group.mapping.status.error}
                  </Typography>
                ) : null
              }
            />
            <ListItemSecondaryAction sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {getSyncStatus(group)}
              <Switch
                edge="end"
                checked={group.mapping?.syncEnabled ?? false}
                onChange={() => handleSyncToggle(group.id)}
              />
            </ListItemSecondaryAction>
          </ListItem>
        ))}
      </List>

      {groups.length === 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
          <InfoIcon fontSize="small" />
          <Typography variant="body2">
            No tab groups found
          </Typography>
        </Box>
      )}
    </Box>
  );
}
