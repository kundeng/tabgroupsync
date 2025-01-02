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
  const snapshotManager = React.useMemo(() => new SnapshotManager(storage), [storage]);

  const loadSnapshots = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await snapshotManager.listSnapshots(groupId);
      setSnapshots(list.sort((a, b) => b.timestamp - a.timestamp));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load snapshots';
      setError(message);
      logger.error('snapshotList:loadFailed', { groupId, error: message });
    } finally {
      setLoading(false);
    }
  }, [groupId, snapshotManager, logger]);

  React.useEffect(() => {
    if (showHistory) {
      loadSnapshots();
    }
  }, [showHistory, loadSnapshots]);

  const handleCreateSnapshot = async () => {
    setError(null);
    try {
      await snapshotManager.createSnapshot(groupId, groupName);
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
      await snapshotManager.deleteSnapshot(snapshotId);
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
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Tooltip title="Create snapshot">
          <IconButton onClick={handleCreateSnapshot} size="small">
            <CameraIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="View snapshot history">
          <IconButton onClick={() => setShowHistory(true)} size="small">
            <HistoryIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Dialog
        open={showHistory}
        onClose={() => setShowHistory(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Snapshots - {groupName}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Typography color="error" sx={{ mb: 2 }}>
              {error}
            </Typography>
          )}
          
          {loading ? (
            <Typography color="text.secondary">
              Loading snapshots...
            </Typography>
          ) : snapshots.length === 0 ? (
            <Typography color="text.secondary">
              No snapshots found
            </Typography>
          ) : (
            <List>
              {snapshots.map((snapshot) => (
                <ListItem
                  key={snapshot.id}
                  secondaryAction={
                    <Tooltip title="Delete snapshot">
                      <IconButton
                        edge="end"
                        onClick={() => handleDeleteSnapshot(snapshot.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <ListItemText
                    primary={new Date(snapshot.timestamp).toLocaleString()}
                    secondary={snapshot.description}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowHistory(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
