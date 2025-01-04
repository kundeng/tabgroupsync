import React from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Typography,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  History as HistoryIcon,
  Camera as CameraIcon,
} from '@mui/icons-material';
import { SnapshotManager, SnapshotMetadata } from '../lib/bookmarks/snapshotManager';
import { StorageManager } from '../lib/storage/storageManager';
import { Logger } from '../lib/utils/logger';

interface SnapshotListProps {
  storage: StorageManager;
  groupId: string;
  groupName: string;
  onSnapshotCreated?: () => void;
}

export default function SnapshotList({ storage, groupId, groupName, onSnapshotCreated }: SnapshotListProps) {
  const [snapshots, setSnapshots] = React.useState<SnapshotMetadata[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);
  const logger = Logger.getInstance();

  const loadSnapshots = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await new Promise<{ snapshots: SnapshotMetadata[] }>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'LIST_SNAPSHOTS', groupId }, response => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      setSnapshots(response.snapshots.sort((a, b) => b.timestamp - a.timestamp));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load snapshots';
      setError(message);
      logger.error('snapshotList:loadFailed', { groupId, error: message });
    } finally {
      setLoading(false);
    }
  }, [groupId, logger]);

  React.useEffect(() => {
    if (showHistory) {
      loadSnapshots();
    }
  }, [showHistory, loadSnapshots]);

  const handleCreateSnapshot = async () => {
    setError(null);
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'CREATE_SNAPSHOT', groupId, groupName },
          response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response.snapshot);
            }
          }
        );
      });
      logger.info('snapshot:created', { groupId, groupName });
      await loadSnapshots();
      onSnapshotCreated?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create snapshot';
      setError(message);
      logger.error('snapshot:createFailed', { groupId, groupName, error: message });
    }
  };

  const handleDeleteSnapshot = async (snapshotId: string) => {
    setError(null);
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'DELETE_SNAPSHOT', snapshotId },
          response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response.success);
            }
          }
        );
      });
      logger.info('snapshot:deleted', { snapshotId });
      await loadSnapshots();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete snapshot';
      setError(message);
      logger.error('snapshot:deleteFailed', { snapshotId, error: message });
    }
  };

  return (
    <>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Tooltip title="View snapshot history">
          <IconButton 
            onClick={() => setShowHistory(true)} 
            size="small"
            sx={{ 
              padding: '6px',
              '& .MuiSvgIcon-root': {
                fontSize: '1.2rem'
              }
            }}
          >
            <HistoryIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Create snapshot">
          <IconButton 
            onClick={handleCreateSnapshot} 
            size="small"
            sx={{ 
              padding: '6px',
              '& .MuiSvgIcon-root': {
                fontSize: '1.2rem'
              }
            }}
          >
            <CameraIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Dialog
        open={showHistory}
        onClose={() => setShowHistory(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            maxHeight: '80vh'
          }
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontSize: '1rem', mb: 0.5 }}>
              Snapshots
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {groupName}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          {error && (
            <Typography color="error" variant="body2" sx={{ mb: 2 }}>
              {error}
            </Typography>
          )}
          
          {loading ? (
            <Typography color="text.secondary" variant="body2">
              Loading snapshots...
            </Typography>
          ) : snapshots.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              No snapshots found
            </Typography>
          ) : (
            <List sx={{ py: 0 }}>
              {snapshots.map((snapshot) => (
                <ListItem
                  key={snapshot.id}
                  sx={{
                    py: 1,
                    '&:hover': {
                      bgcolor: 'action.hover'
                    }
                  }}
                  secondaryAction={
                    <Tooltip title="Delete snapshot">
                      <IconButton
                        onClick={() => handleDeleteSnapshot(snapshot.id)}
                        size="small"
                        sx={{ 
                          padding: '6px',
                          '& .MuiSvgIcon-root': {
                            fontSize: '1.2rem'
                          }
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <ListItemText
                    primary={new Date(snapshot.timestamp).toLocaleString()}
                    secondary={snapshot.description}
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
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowHistory(false)} size="small">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
