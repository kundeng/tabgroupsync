import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Collapse,
  IconButton,
} from '@mui/material';
import {
  ExpandLess,
  ExpandMore,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Folder as FolderIcon,
  Tab as TabIcon,
} from '@mui/icons-material';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncHistoryEntry } from '../lib/types/storage';

interface SyncStatusProps {
  storage: StorageManager;
}

export default function SyncStatus({ storage }: SyncStatusProps) {
  const [history, setHistory] = React.useState<SyncHistoryEntry[]>([]);
  const [expanded, setExpanded] = React.useState(false);

  // Subscribe to storage changes
  React.useEffect(() => {
    const loadHistory = async () => {
      const history = await storage.getHistory();
      setHistory(history);
    };

    loadHistory();

    const unsubscribe = storage.subscribe((event) => {
      if (event.type === 'history-added') {
        loadHistory();
      }
    });

    return unsubscribe;
  }, [storage]);

  const getEntryIcon = (entry: SyncHistoryEntry) => {
    if (!entry.success) {
      return <ErrorIcon color="error" />;
    }

    switch (entry.type) {
      case 'group-to-folder':
        return <FolderIcon color="primary" />;
      case 'folder-to-group':
        return <TabIcon color="primary" />;
      case 'ungrouped':
        return <TabIcon color="action" />;
      default:
        return <SuccessIcon color="success" />;
    }
  };

  const getEntryText = (entry: SyncHistoryEntry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    
    if (!entry.success) {
      return {
        primary: 'Sync Failed',
        secondary: `${time} - ${entry.error}`,
      };
    }

    switch (entry.type) {
      case 'group-to-folder':
        return {
          primary: 'Group Synced to Folder',
          secondary: time,
        };
      case 'folder-to-group':
        return {
          primary: 'Folder Synced to Group',
          secondary: time,
        };
      case 'ungrouped':
        return {
          primary: 'Ungrouped Tabs Synced',
          secondary: time,
        };
      default:
        return {
          primary: 'Unknown Operation',
          secondary: time,
        };
    }
  };

  if (history.length === 0) return null;

  return (
    <Box sx={{ mt: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Typography variant="subtitle1">
          Sync History
        </Typography>
        <IconButton size="small">
          {expanded ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        <List dense>
          {history.slice(0, 5).map((entry, index) => (
            <ListItem key={index}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                {getEntryIcon(entry)}
              </ListItemIcon>
              <ListItemText {...getEntryText(entry)} />
            </ListItem>
          ))}
        </List>
      </Collapse>
    </Box>
  );
}
