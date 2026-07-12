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
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  DriveFileMove as DriveFileMoveIcon,
  Refresh as RefreshIcon,
  OpenInNew as RestoreIcon,
  InsertDriveFile as FileIcon,
  CloudDownload as RestoreMenuIcon,
  PlaylistAdd as AddMissingIcon,
  SwapHoriz as ReplaceIcon,
} from '@mui/icons-material';
import { GroupViewModel } from '../lib/types/storage';
import { StorageManager } from '../lib/storage/storageManager';
import { localizeFileUrl, osFromUserAgent } from '../lib/utils/pathMapper';
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
  const [menuAnchor, setMenuAnchor] = React.useState<{ el: HTMLElement; group: GroupViewModel } | null>(null);

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

  // Fetch everything needed to map a saved bookmark URL to THIS machine's local
  // path: manual rules (fallback) + learned home + OS (for zero-config home-swap).
  const getMapping = async () => {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get('state:pathMappings'),
      chrome.storage.local.get(['machineId', 'localHome'])
    ]);
    const store = syncData['state:pathMappings'] as any;
    const mid = localData.machineId as string;
    return {
      rules: (store?.machines?.[mid]?.rules || []) as Array<{canonicalPrefix: string; localPrefix: string}>,
      localHome: (localData.localHome as string) || null,
      localOs: osFromUserAgent(navigator.userAgent),
    };
  };

  // Saved bookmark URL → this-machine local path (rules, then zero-config home-swap).
  const localizeUrl = (url: string, m: Awaited<ReturnType<typeof getMapping>>) =>
    localizeFileUrl(url, m.localHome, { machineId: '', rules: m.rules }, m.localOs);

  const handleRestoreAction = async (group: GroupViewModel, mode: 'all' | 'missing' | 'files' | 'replace') => {
    if (!group.folder?.id) return;
    setMenuAnchor(null);
    setRestoringFiles(prev => ({ ...prev, [group.id]: true }));
    try {
      const mapping = await getMapping();
      const bookmarks = await chrome.bookmarks.getChildren(group.folder.id);
      const bmUrls = bookmarks.filter(b => b.url).map(b => ({
        original: b.url!,
        resolved: localizeUrl(b.url!, mapping)
      }));

      if (mode === 'files') {
        const fileOnly = bmUrls.filter(u => u.resolved.startsWith('file://'));
        if (fileOnly.length === 0) {
          setErrors(prev => ({ ...prev, [group.id]: { message: 'No file:// URLs in this group', timestamp: Date.now() } }));
          return;
        }
      }

      const urlsToOpen = mode === 'files'
        ? bmUrls.filter(u => u.resolved.startsWith('file://'))
        : bmUrls;

      // Find existing group tabs
      const allTabGroups = await chrome.tabGroups.query({});
      const matchingGroup = allTabGroups.find(g => g.title === group.name);
      let openUrls = new Set<string>();

      if (matchingGroup) {
        const existingTabs = await chrome.tabs.query({ groupId: matchingGroup.id });
        openUrls = new Set(existingTabs.map(t => t.url || ''));

        if (mode === 'replace') {
          for (const tab of existingTabs) {
            if (tab.id) await chrome.tabs.remove(tab.id);
          }
          openUrls = new Set();
        }
      }

      const created: chrome.tabs.Tab[] = [];
      for (const { resolved } of urlsToOpen) {
        if (mode !== 'replace' && mode !== 'all' && openUrls.has(resolved)) continue;
        if (mode === 'all' && openUrls.has(resolved)) continue;
        try {
          const tab = await chrome.tabs.create({ url: resolved, active: false });
          created.push(tab);
        } catch {
          const openerUrl = chrome.runtime.getURL('opener.html')
            + '?target=' + encodeURIComponent(resolved);
          const tab = await chrome.tabs.create({ url: openerUrl, active: false });
          created.push(tab);
        }
      }

      if (created.length > 0) {
        const tabIds = created.map(t => t.id!).filter(Boolean);
        if (matchingGroup && mode !== 'replace') {
          await chrome.tabs.group({ tabIds, groupId: matchingGroup.id });
        } else {
          const gid = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(gid, { title: group.name, collapsed: false });
        }
      }

      setErrors(prev => { const n = {...prev}; delete n[group.id]; return n; });
    } catch (error) {
      setErrors(prev => ({ ...prev, [group.id]: { message: error instanceof Error ? error.message : 'Failed', timestamp: Date.now() } }));
    } finally {
      setRestoringFiles(prev => ({ ...prev, [group.id]: false }));
    }
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

                      <Tooltip title={!group.folder?.id ? 'No bookmark folder' : 'Restore tabs from bookmarks'}>
                        <span>
                          <IconButton
                            onClick={(e) => setMenuAnchor({ el: e.currentTarget, group })}
                            disabled={!group.folder?.id || restoringFiles[group.id]}
                            size="small"
                            sx={{ padding: '6px' }}
                          >
                            {restoringFiles[group.id] ? (
                              <CircularProgress size={16} />
                            ) : (
                              <RestoreMenuIcon fontSize="small" />
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
    <Menu
      anchorEl={menuAnchor?.el}
      open={!!menuAnchor}
      onClose={() => setMenuAnchor(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <MenuItem onClick={() => menuAnchor && handleRestoreAction(menuAnchor.group, 'all')}>
        <ListItemIcon><RestoreIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Restore all tabs" secondary="Open all bookmarks as tabs" />
      </MenuItem>
      <MenuItem onClick={() => menuAnchor && handleRestoreAction(menuAnchor.group, 'missing')}>
        <ListItemIcon><AddMissingIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Add missing tabs" secondary="Only open tabs not already in group" />
      </MenuItem>
      <MenuItem onClick={() => menuAnchor && handleRestoreAction(menuAnchor.group, 'files')}>
        <ListItemIcon><FileIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Add file:// tabs only" secondary="Open local file bookmarks with path mapping" />
      </MenuItem>
      <Divider />
      <MenuItem onClick={() => menuAnchor && handleRestoreAction(menuAnchor.group, 'replace')}>
        <ListItemIcon><ReplaceIcon fontSize="small" color="error" /></ListItemIcon>
        <ListItemText primary="Replace group" primaryTypographyProps={{ color: 'error' }} secondary="Close existing tabs, restore fresh" />
      </MenuItem>
    </Menu>
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
