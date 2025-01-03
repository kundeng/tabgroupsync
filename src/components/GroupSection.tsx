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
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Archive as ArchiveIcon,
  Unarchive as UnarchiveIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { GroupViewModel } from '../lib/types/storage';
import { StorageManager } from '../lib/storage/storageManager';
import SnapshotList from './SnapshotList';

interface GroupSectionProps {
  title: string;
  groups: GroupViewModel[];
  storage: StorageManager;
  onToggleSync: (groupId: string, enabled: boolean) => void;
  onFullResync: (group: GroupViewModel) => void;
  onArchive?: (group: GroupViewModel) => void;
  onRestore?: (group: GroupViewModel) => void;
  onDelete?: (group: GroupViewModel) => void;
  disabled?: boolean;
}

export default function GroupSection({
  title,
  groups,
  onToggleSync,
  onFullResync,
  onArchive,
  onRestore,
  onDelete,
  disabled = false,
  storage
}: GroupSectionProps) {
  const [expanded, setExpanded] = React.useState(true);
  const [syncing, setSyncing] = React.useState<Record<string, boolean>>({});

  const handleFullResync = async (group: GroupViewModel) => {
    setSyncing(prev => ({ ...prev, [group.id]: true }));
    try {
      await onFullResync(group);
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
                opacity: disabled ? 0.6 : 1,
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
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                      {group.syncEnabled ? 'Backing up to bookmarks' : 'Sync paused'}
                    </Typography>
                    {group.inactiveFor !== undefined && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.8rem', display: 'block' }}>
                        {getInactiveText(group.inactiveFor)}
                      </Typography>
                    )}
                  </Box>
                </Grid>
                {!disabled && (
                  <Grid item style={{ flexShrink: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {onArchive && !group.isArchived && (
                        <Tooltip title="Archive group">
                          <IconButton
                            onClick={() => onArchive(group)}
                            size="small"
                            sx={{ padding: '6px' }}
                          >
                            <ArchiveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onRestore && group.isArchived && (
                        <Tooltip title="Restore group">
                          <IconButton
                            onClick={() => onRestore(group)}
                            size="small"
                            sx={{ padding: '6px' }}
                          >
                            <UnarchiveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onDelete && group.isArchived && (
                        <Tooltip title="Delete group and bookmarks">
                          <IconButton
                            onClick={() => onDelete(group)}
                            size="small"
                            color="error"
                            sx={{ padding: '6px' }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <SnapshotList
                        storage={storage}
                        groupId={group.id}
                        groupName={group.name}
                      />
                      <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 24 }} />
                      <Tooltip title="Full resync (replaces all bookmarks)">
                        <span>
                          <IconButton
                            onClick={() => handleFullResync(group)}
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
                      <Tooltip title={group.syncEnabled ? 'Pause backup' : 'Resume backup'}>
                        <Switch
                          size="small"
                          checked={group.syncEnabled}
                          onChange={(e) => onToggleSync(group.id, e.target.checked)}
                          sx={{
                            '& .MuiSwitch-switchBase': {
                              padding: '4px'
                            }
                          }}
                        />
                      </Tooltip>
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
