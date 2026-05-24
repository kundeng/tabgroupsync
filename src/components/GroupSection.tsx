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
  DriveFileMove as DriveFileMoveIcon,
  Refresh as RefreshIcon,
  OpenInNew as RestoreIcon,
  InsertDriveFile as FileIcon,
} from '@mui/icons-material';
import { GroupViewModel } from '../lib/types/storage';
import { StorageManager } from '../lib/storage/storageManager';
import SnapshotList from './SnapshotList';
import MoveGroupDialog from './MoveGroupDialog';

interface GroupSectionProps {
  title: string;
  groups: GroupViewModel[];
  storage: StorageManager;
  parentFolder: chrome.bookmarks.BookmarkTreeNode | null;
  onToggleSync: (name: string) => void;
  onFullResync: (group: GroupViewModel) => void;
  onMoveGroup?: (group: GroupViewModel, targetWindowId: number) => Promise<void>;
  onRestoreGroup?: (group: GroupViewModel) => Promise<void>;
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
  onMoveGroup,
  onRestoreGroup,
  readOnly = false
}: GroupSectionProps) {
  const [expanded, setExpanded] = React.useState(true);
  const [syncing, setSyncing] = React.useState<Record<string, boolean>>({});
  const [moving, setMoving] = React.useState<Record<string, boolean>>({});
  const [restoring, setRestoring] = React.useState<Record<string, boolean>>({});
  const [errors, setErrors] = React.useState<Record<string, ErrorWithTimestamp>>({});
  const [moveDialogGroup, setMoveDialogGroup] = React.useState<GroupViewModel | null>(null);
  const [restoringFiles, setRestoringFiles] = React.useState<Record<string, boolean>>({});

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
    <>
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
                            group.status.error ? (
                              group.status.error.includes('not found') ? 
                                'Waiting for group to be available...' :
                                group.status.error
                            ) : (
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

                      <Tooltip title={!group.folder?.id ? 'No bookmark folder' : 'Open file:// tabs from bookmarks'}>
                        <span>
                          <IconButton
                            onClick={async () => {
                              if (!group.folder?.id) return;
                              setRestoringFiles(prev => ({ ...prev, [group.id]: true }));
                              try {
                                const [syncData, localData] = await Promise.all([
                                  chrome.storage.sync.get('state:pathMappings'),
                                  chrome.storage.local.get('machineId')
                                ]);
                                const store = syncData['state:pathMappings'] as any;
                                const mid = localData.machineId as string;
                                const rules = (store?.machines?.[mid]?.rules || []) as Array<{canonicalPrefix: string; localPrefix: string}>;

                                const bookmarks = await chrome.bookmarks.getChildren(group.folder!.id);
                                const fileUrls = bookmarks.filter(b => b.url?.startsWith('file://'));
                                if (fileUrls.length === 0) {
                                  setErrors(prev => ({ ...prev, [group.id]: { message: 'No file:// URLs in this group', timestamp: Date.now() } }));
                                  return;
                                }

                                const existingTabs = await chrome.tabs.query({});
                                const groupTabs = existingTabs.filter(t => t.groupId !== -1);
                                const matchingGroup = await chrome.tabGroups.query({}).then(gs => gs.find(g => g.title === group.name));
                                const openUrls = new Set(
                                  matchingGroup ? groupTabs.filter(t => t.groupId === matchingGroup.id).map(t => t.url || '') : []
                                );

                                const created: chrome.tabs.Tab[] = [];
                                for (const bm of fileUrls) {
                                  let resolved = bm.url!;
                                  for (const rule of rules) {
                                    const canon = rule.canonicalPrefix.replace(/\/$/, '');
                                    if (resolved.startsWith('file://' + canon + '/') || resolved === 'file://' + canon) {
                                      resolved = 'file://' + rule.localPrefix.replace(/\/$/, '') + resolved.slice(7 + canon.length);
                                      break;
                                    }
                                  }
                                  if (openUrls.has(resolved)) continue;
                                  const tab = await chrome.tabs.create({ url: resolved, active: false });
                                  created.push(tab);
                                }

                                if (created.length > 0) {
                                  const tabIds = created.map(t => t.id!).filter(Boolean);
                                  if (matchingGroup) {
                                    await chrome.tabs.group({ tabIds, groupId: matchingGroup.id });
                                  } else {
                                    const gid = await chrome.tabs.group({ tabIds });
                                    await chrome.tabGroups.update(gid, { title: group.name, collapsed: true });
                                  }
                                }

                                setErrors(prev => { const n = {...prev}; delete n[group.id]; return n; });
                              } catch (error) {
                                setErrors(prev => ({ ...prev, [group.id]: { message: error instanceof Error ? error.message : 'Failed', timestamp: Date.now() } }));
                              } finally {
                                setRestoringFiles(prev => ({ ...prev, [group.id]: false }));
                              }
                            }}
                            disabled={!group.folder?.id || restoringFiles[group.id]}
                            size="small"
                            sx={{ padding: '6px' }}
                          >
                            {restoringFiles[group.id] ? (
                              <CircularProgress size={16} />
                            ) : (
                              <FileIcon fontSize="small" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>

                      <Tooltip title={!group.isActive ? 'Group must be active to move' : 'Move group to another window'}>
                        <span>
                          <IconButton
                            onClick={() => setMoveDialogGroup(group)}
                            disabled={!group.isActive || moving[group.id]}
                            size="small"
                            sx={{ padding: '6px' }}
                          >
                            {moving[group.id] ? (
                              <CircularProgress size={16} />
                            ) : (
                              <DriveFileMoveIcon fontSize="small" />
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
                      {group.folder && onRestoreGroup && (
                        <Tooltip title="Open as tab group">
                          <span>
                            <IconButton
                              onClick={async () => {
                                setRestoring(prev => ({ ...prev, [group.id]: true }));
                                try {
                                  await onRestoreGroup(group);
                                  setErrors(prev => { const next = { ...prev }; delete next[group.id]; return next; });
                                } catch (error) {
                                  const message = error instanceof Error ? error.message : 'Failed to restore';
                                  setErrors(prev => ({ ...prev, [group.id]: { message, timestamp: Date.now() } }));
                                } finally {
                                  setRestoring(prev => ({ ...prev, [group.id]: false }));
                                }
                              }}
                              disabled={restoring[group.id]}
                              size="small"
                              color="primary"
                              sx={{ padding: '6px' }}
                            >
                              {restoring[group.id] ? (
                                <CircularProgress size={16} />
                              ) : (
                                <RestoreIcon fontSize="small" />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
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
    {moveDialogGroup && onMoveGroup && (
      <MoveGroupDialog
        open={!!moveDialogGroup}
        sourceWindowId={moveDialogGroup.windowId}
        onClose={() => setMoveDialogGroup(null)}
        onConfirm={async (targetWindowId) => {
          const group = moveDialogGroup;
          setMoving(prev => ({ ...prev, [group.id]: true }));
          try {
            await onMoveGroup(group, targetWindowId);
            setErrors(prev => {
              const next = { ...prev };
              delete next[group.id];
              return next;
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to move group';
            setErrors(prev => ({
              ...prev,
              [group.id]: {
                message,
                timestamp: Date.now()
              }
            }));
            throw error;
          } finally {
            setMoving(prev => ({ ...prev, [group.id]: false }));
          }
        }}
      />
    )}
    </>
  );
}
