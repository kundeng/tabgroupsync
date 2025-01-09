import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  Grid,
  Switch,
  IconButton,
  Tooltip,
  CircularProgress,
  Divider,
  Collapse,
  Alert,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { GroupViewModel } from '../lib/types/storage';
import { StorageManager } from '../lib/storage/storageManager';
import SnapshotList from './SnapshotList';

interface GroupSectionProps {
  title: string;
  groups: GroupViewModel[];
  storage: StorageManager;
  parentFolder: chrome.bookmarks.BookmarkTreeNode | null;
  onToggleSync: (name: string) => void;
  onFullResync: (group: GroupViewModel) => void;
  readOnly?: boolean;
}

interface ErrorWithTimestamp {
  message: string;
  timestamp: number;
}

export default function GroupSection({
  title,
  groups,
  storage,
  parentFolder,
  onToggleSync,
  onFullResync,
  readOnly = false
}: GroupSectionProps) {
  const [expanded, setExpanded] = React.useState(true);
  const [syncing, setSyncing] = React.useState<Record<string, boolean>>({});
  const [errors, setErrors] = React.useState<Record<string, ErrorWithTimestamp>>({});

  const handleFullResync = async (group: GroupViewModel) => {
    if (!parentFolder) {
      setErrors(prev => ({
        ...prev,
        [group.id]: {
          message: 'Please select a location for your bookmarks first',
          timestamp: Date.now()
        }
      }));
      return;
    }

    setSyncing(prev => ({ ...prev, [group.id]: true }));
    try {
      await onFullResync(group);
      setErrors(prev => {
        const next = { ...prev };
        delete next[group.id];
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync';
      setErrors(prev => ({ 
        ...prev, 
        [group.id]: {
          message,
          timestamp: Date.now()
        }
      }));
    } finally {
      setSyncing(prev => ({ ...prev, [group.id]: false }));
    }
  };

  const getInactiveText = (days: number) => {
    if (days < 1) return 'Last seen today';
    if (days === 1) return 'Last seen yesterday';
    return `Last seen ${days} days ago`;
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          mb: 1,
          px: 2
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <IconButton size="small">
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
        <Typography variant="subtitle2" sx={{ ml: 0.5 }}>
          {title} ({groups.length})
        </Typography>
      </Box>

      <Collapse in={expanded}>
        <List sx={{ py: 0 }}>
          {groups.map((group) => (
            <ListItem
              key={group.id}
              sx={{
                borderLeft: `4px solid ${group.color || '#ccc'}`,
                bgcolor: 'background.paper',
                mb: 1,
                borderRadius: 1,
                opacity: readOnly ? 0.6 : 1,
                py: 1.5,
                px: 2,
                '&:hover': {
                  bgcolor: 'action.hover'
                }
              }}
            >
              <Grid container spacing={3} alignItems="center" wrap="nowrap">
                <Grid item xs style={{ minWidth: 0 }}>
                  <Box sx={{ pr: 1 }}>
                    <Typography sx={{ fontWeight: 500, fontSize: '0.95rem' }}>
                      {group.name}
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Typography variant="caption" sx={{ 
                        fontSize: '0.8rem',
                        color: group.status.error ? 'error.main' : 'text.secondary'
                      }}>
                        {!group.syncEnabled ? 'Backup paused' : (
                          group.status.inProgress ? 'Syncing...' : (
                            group.status.error ? `Backup paused - ${group.status.error}` : (
                              group.status.lastSynced ? 
                                new Date(group.status.lastSynced).toLocaleTimeString() :
                                'Not synced yet'
                            )
                          )
                        )}
                      </Typography>

                      {/* Operation Errors */}
                      {errors[group.id] && (
                        <Alert severity="error" sx={{ mt: 1, py: 0 }}>
                          {errors[group.id].message}
                          <Typography variant="caption" sx={{ 
                            display: 'block',
                            fontSize: '0.75rem',
                            color: 'error.light',
                            mt: 0.5
                          }}>
                            {new Date(errors[group.id].timestamp).toLocaleTimeString()}
                          </Typography>
                        </Alert>
                      )}
                    </Box>
                  </Box>
                </Grid>
                {!readOnly ? (
                  <Grid item style={{ flexShrink: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {/* Primary Actions */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Tooltip title={!parentFolder ? 'Select a location for your bookmarks first' : (group.syncEnabled ? 'Pause backup' : 'Resume backup')}>
                          <span>
                            <Switch
                              size="small"
                              checked={group.syncEnabled}
                              onChange={async () => {
                                if (!parentFolder) {
                                  setErrors(prev => ({
                                    ...prev,
                                    [group.id]: {
                                      message: 'Please select a location for your bookmarks first',
                                      timestamp: Date.now()
                                    }
                                  }));
                                  return;
                                }

                                try {
                                  await onToggleSync(group.name);
                                  setErrors(prev => {
                                    const next = { ...prev };
                                    delete next[group.id];
                                    return next;
                                  });
                                } catch (error) {
                                  const message = error instanceof Error ? error.message : 'Failed to toggle sync';
                                  if (!message.includes('cancelled')) {
                                    setErrors(prev => ({ 
                                      ...prev, 
                                      [group.id]: {
                                        message: `Failed to toggle sync: ${message}`,
                                        timestamp: Date.now()
                                      }
                                    }));
                                  }
                                }
                              }}
                              disabled={!parentFolder} // Disable if no parent folder
                              sx={{
                                '& .MuiSwitch-switchBase': {
                                  padding: '4px'
                                }
                              }}
                            />
                          </span>
                        </Tooltip>
                      </Box>

                      <Tooltip title={!group.syncEnabled ? 'Enable backup first' : 'Full resync (replaces all bookmarks)'}>
                        <span>
                          <IconButton
                            onClick={async () => {
                              try {
                                await handleFullResync(group);
                              } catch (error) {
                                // Error is handled in handleFullResync
                              }
                            }}
                            disabled={!group.syncEnabled || syncing[group.id]}
                            size="small"
                            sx={{ padding: '6px' }}
                          >
                            {syncing[group.id] ? (
                              <CircularProgress size={16} />
                            ) : (
                              <RefreshIcon fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>

                      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 24 }} />

                      {/* Snapshots */}
                      <Box sx={{ opacity: (!group.syncEnabled || !group.folder?.id) ? 0.5 : 1 }}>
                        <Tooltip title={
                          !group.syncEnabled ? 'Enable backup to use snapshots' :
                          !group.folder?.id ? 'Waiting for folder to be created...' :
                          ''
                        }>
                          <span>
                            <SnapshotList
                              storage={storage}
                              groupId={group.folder?.id} // Use bookmark folder ID
                              groupName={group.name}
                              disabled={!group.syncEnabled || !group.folder?.id}
                            />
                          </span>
                        </Tooltip>
                      </Box>
                    </Box>
                  </Grid>
                ) : (
                  <Grid item style={{ flexShrink: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                      <Typography variant="caption">
                        {group.syncEnabled ? (
                          group.status.lastSynced ? 
                            `Last backup: ${new Date(group.status.lastSynced).toLocaleTimeString()}` :
                            'Not backed up yet'
                        ) : 'Not configured for backup'}
                      </Typography>
                    </Box>
                  </Grid>
                )}
              </Grid>
            </ListItem>
          ))}
        </List>
      </Collapse>
    </Box>
  );
}
