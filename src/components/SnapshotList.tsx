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
  CircularProgress,
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
  groupId?: string;
  groupName: string;
  onSnapshotCreated?: () => void;
  disabled?: boolean;
}

export default function SnapshotList({ storage, groupId, groupName, onSnapshotCreated, disabled }: SnapshotListProps) {
  const [snapshots, setSnapshots] = React.useState<SnapshotMetadata[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);
  const [status, setStatus] = React.useState<'idle' | 'creating' | 'success' | 'error'>('idle');
  const logger = Logger.getInstance();

  const loadSnapshots = React.useCallback(async () => {
    if (!groupId) {
      setError('No folder selected');
      return;
    }

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
    if (!groupId) {
      setError('No folder selected');
      setStatus('error');
      setTimeout(() => {
        setStatus('idle');
        setError(null);
      }, 3000);
      return;
    }

    setError(null);
    setCreating(true);
    setStatus('creating');
    try {
      const response = await new Promise<{ snapshot?: any; error?: string }>((resolve, reject) => {
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
      if (response.error) {
        throw new Error(response.error);
      }
      logger.info('snapshot:created', { groupId, groupName });
      await loadSnapshots();
      onSnapshotCreated?.();
      
      setStatus('success');
      // Reset status after a delay
      setTimeout(() => {
        setStatus('idle');
      }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create snapshot';
      setError(message);
      logger.error('snapshot:createFailed', { groupId, groupName, error: message });
      
      setStatus('error');
      // Reset status after a delay
      setTimeout(() => {
        setStatus('idle');
        setError(null);
      }, 3000);
    } finally {
      setCreating(false);
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
      <Box sx={{ display: 'flex', gap: 0.5, position: 'relative' }}>
        <Tooltip title={!groupId ? 'No folder selected' : 'View snapshot history'}>
          <IconButton 
            onClick={() => setShowHistory(true)} 
            size="small"
            disabled={disabled || !groupId}
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
        <Tooltip title={
          !groupId ? 'No folder selected' :
          error ? error :
          status === 'creating' ? 'Creating snapshot...' :
          status === 'success' ? 'Snapshot created' :
          'Create snapshot'
        }>
          <IconButton 
            onClick={handleCreateSnapshot} 
            size="small"
            disabled={disabled || !groupId || creating}
            sx={{ 
              padding: '6px',
              '& .MuiSvgIcon-root': {
                fontSize: '1.2rem',
                color: error ? 'error.main' :
                       status === 'success' ? 'success.main' :
                       'inherit'
              }
            }}
          >
            {creating ? (
              <CircularProgress size={16} />
            ) : (
              <CameraIcon fontSize="small" />
            )}
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
