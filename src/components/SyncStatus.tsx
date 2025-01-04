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
  Paper,
} from '@mui/material';
import {
  ExpandLess,
  ExpandMore,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncHistoryEntry } from '../lib/types/storage';

interface SyncStatusProps {
  storage: StorageManager;
}

export default function SyncStatus({ storage }: SyncStatusProps) {
  const [history, setHistory] = React.useState<SyncHistoryEntry[]>([]);
  const [expanded, setExpanded] = React.useState(false);

  // Listen for storage changes
  React.useEffect(() => {
    const loadHistory = async () => {
      const history = await storage.getHistory();
      setHistory(history);
    };

    loadHistory();

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.lastEvent?.newValue?.type === 'history-added') {
        loadHistory();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [storage]);

  const getEntryIcon = (entry: SyncHistoryEntry) => {
    return entry.success ? 
      <SuccessIcon color="success" fontSize="small" /> :
      <ErrorIcon color="error" fontSize="small" />;
  };

  const getEntryText = (entry: SyncHistoryEntry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    
    if (!entry.success) {
      return {
        primary: 'Backup paused',
        secondary: `${time} - ${entry.error}`,
      };
    }

    return {
      primary: 'Last synced',
      secondary: time,
    };
  };

  if (history.length === 0) return null;

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          minHeight: '32px'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Typography 
          variant="body2" 
          color="text.secondary"
          sx={{ 
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            fontWeight: 500
          }}
        >
          {getEntryIcon(history[0])}
          {getEntryText(history[0]).primary}
        </Typography>
        <IconButton size="small" sx={{ padding: '4px' }}>
          {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        <Paper 
          variant="outlined" 
          sx={{ 
            mt: 1, 
            maxHeight: '200px',
            overflow: 'auto',
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              background: '#bbb',
              borderRadius: '4px',
              '&:hover': {
                background: '#999',
              },
            },
          }}
        >
          <List dense sx={{ py: 0 }}>
            {history.slice(0, 10).map((entry, index) => (
              <ListItem 
                key={index}
                sx={{
                  py: 0.5,
                  '&:hover': {
                    bgcolor: 'action.hover'
                  }
                }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  {getEntryIcon(entry)}
                </ListItemIcon>
                <ListItemText 
                  {...getEntryText(entry)}
                  primaryTypographyProps={{
                    variant: 'body2',
                    sx: { fontWeight: 500 }
                  }}
                  secondaryTypographyProps={{
                    variant: 'caption',
                    sx: { fontSize: '0.8rem' }
                  }}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      </Collapse>
    </Box>
  );
}
