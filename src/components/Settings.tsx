import React from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControlLabel,
  Switch,
  Typography,
  CircularProgress,
  Divider,
  Slider,
  Alert,
} from '@mui/material';
import FolderPicker from './FolderPicker';
import {
  Settings as SettingsIcon,
  FileDownload as ExportIcon,
  FileUpload as ImportIcon,
  CleaningServices as CleanupIcon,
} from '@mui/icons-material';
import type { CruftCandidate } from '../lib/bookmarks/cleanupPrefixCruft';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncEngine } from '../lib/sync/syncEngine';
import { BookmarkManager } from '../lib/bookmarks/bookmarkManager';
import { Logger } from '../lib/utils/logger';
import { localize } from '../lib/utils/pathMapper';
import LocationDisplay from './LocationDisplay';

interface SettingsProps {
  storage: StorageManager;
  syncEngine: SyncEngine;
  bookmarkManager: BookmarkManager;
}

function FileAccessBanner() {
  const [hasAccess, setHasAccess] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    chrome.extension.isAllowedFileSchemeAccess((allowed) => {
      setHasAccess(allowed);
    });
  }, []);
  if (hasAccess === null || hasAccess) return null;
  const extUrl = `chrome://extensions/?id=${chrome.runtime.id}`;
  return (
    <Alert severity="info" sx={{ mt: 1.5, fontSize: '12px' }}>
      <strong>File URL access not enabled.</strong> To open file:// tabs,
      go to{' '}
      <a
        href={extUrl}
        onClick={(e) => { e.preventDefault(); chrome.tabs.create({ url: extUrl }); }}
        style={{ color: 'inherit' }}
      >
        extension settings
      </a>{' '}
      and enable "Allow access to file URLs".
    </Alert>
  );
}

export default function Settings({ storage, syncEngine, bookmarkManager }: SettingsProps) {
  const [open, setOpen] = React.useState(false);
  const [autoSync, setAutoSync] = React.useState(false);
  const [cleanupEnabled, setCleanupEnabled] = React.useState(false);
  const [cruftCandidates, setCruftCandidates] = React.useState<CruftCandidate[] | null>(null);
  const [cruftScanning, setCruftScanning] = React.useState(false);
  const [cruftCleaning, setCruftCleaning] = React.useState(false);
  const [cruftResult, setCruftResult] = React.useState<string | null>(null);
  const [inactiveThreshold, setInactiveThreshold] = React.useState(30);
  const [containerFolder, setContainerFolder] = React.useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [isSelectingFolder, setIsSelectingFolder] = React.useState(false);
  const [showFolderPicker, setShowFolderPicker] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [exportImportStatus, setExportImportStatus] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pathMappingsExpanded, setPathMappingsExpanded] = React.useState(false);
  const [machineId, setMachineId] = React.useState('');
  const [mappingRules, setMappingRules] = React.useState<Array<{ canonicalPrefix: string; localPrefix: string }>>([]);
  const [isEdge, setIsEdge] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const logger = Logger.getInstance();

  const loadSettings = React.useCallback(async () => {
    try {
      const response = await new Promise<{ settings: any }>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, response => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      
      setAutoSync(response.settings.autoSync);
      setCleanupEnabled(response.settings.cleanup.enabled);
      setInactiveThreshold(response.settings.cleanup.inactiveThreshold);
      
      // Get container folder ID
      if (response.settings.containerFolderId) {
        const folderResponse = await new Promise<{ folder: chrome.bookmarks.BookmarkTreeNode | null }>((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'GET_TAB_GROUPS_FOLDER' }, response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response);
            }
          });
        });
        setContainerFolder(folderResponse.folder);
      }
    } catch (error) {
      logger.error('settings:load:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [logger]);

  React.useEffect(() => {
    setIsEdge(navigator.userAgent.includes('Edg/'));
  }, []);

  React.useEffect(() => {
    if (open) {
      chrome.storage.local.get('machineId').then((data: Record<string, unknown>) => {
        if (data.machineId) setMachineId(data.machineId as string);
      });
      chrome.storage.sync.get('state:pathMappings').then((data: Record<string, unknown>) => {

        const store = data['state:pathMappings'] as { machines: Record<string, { rules: Array<{ canonicalPrefix: string; localPrefix: string }> }> } | undefined;
        if (store) {
          chrome.storage.local.get('machineId').then((local: Record<string, unknown>) => {
            const mid = local.machineId as string;

            if (mid && store.machines[mid]?.rules?.length > 0) {
              setMappingRules(store.machines[mid].rules);
            }
          });
        }
      });
    }
  }, [open]);

  const savePathMappings = React.useCallback(async (id: string, rules: Array<{ canonicalPrefix: string; localPrefix: string }>) => {
    if (!id.trim()) return;
    await chrome.storage.local.set({ machineId: id.trim() });
    const data = await chrome.storage.sync.get('state:pathMappings') as Record<string, unknown>;
    const store = (data['state:pathMappings'] || { machines: {} }) as { machines: Record<string, unknown> };
    store.machines[id.trim()] = {
      machineId: id.trim(),
      rules: rules.filter(r => r.canonicalPrefix.trim() && r.localPrefix.trim())
    };
    await chrome.storage.sync.set({ 'state:pathMappings': store });

  }, []);

  // Auto-save path mappings on change (debounced)
  React.useEffect(() => {
    if (!pathMappingsExpanded || !machineId.trim()) return;
    const timer = setTimeout(() => {
      savePathMappings(machineId, mappingRules);
    }, 500);
    return () => clearTimeout(timer);
  }, [machineId, mappingRules, pathMappingsExpanded, savePathMappings]);

  React.useEffect(() => {
    loadSettings();

    // Listen for storage changes
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.state?.newValue?.settings) {
        const newSettings = changes.state.newValue.settings;
        setAutoSync(newSettings.autoSync);
        
        // Clear container folder if containerFolderId is removed
        if (!newSettings.containerFolderId) {
          setContainerFolder(null);
        } else {
          // Reload container folder when settings change
          loadSettings();
        }
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [logger, loadSettings]);

  const handleAutoSyncChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked;
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'UPDATE_SETTINGS', settings: { autoSync: enabled } },
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
      setAutoSync(enabled);
      logger.info('settings:autoSync:updated', { enabled });
    } catch (error) {
      logger.error('settings:autoSync:updateFailed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const handleFolderSelect = async (selectedFolder: chrome.bookmarks.BookmarkTreeNode) => {
    setIsSelectingFolder(true);
    setError(null);
    try {
      // Create Tab Group Bookmarks folder and store its ID
      const folderResponse = await new Promise<{ folder: chrome.bookmarks.BookmarkTreeNode }>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'SETUP_TAB_GROUPS_FOLDER', containerFolder: selectedFolder },
          response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response);
            }
          }
        );
      });
      setContainerFolder(folderResponse.folder);
      
      // Reload settings to ensure UI is in sync
      const settingsResponse = await new Promise<{ settings: any }>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, response => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      setAutoSync(settingsResponse.settings.autoSync);
      
      logger.info('settings:tabGroupFolder:setup', { 
        containerId: selectedFolder.id,
        containerName: selectedFolder.title,
        folderId: folderResponse.folder.id
      });
      setShowFolderPicker(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create folder';
      if (!message.includes('cancelled')) {
        setError(message);
        logger.error('settings:tabGroupFolder:setupFailed', { error: message });
      }
    } finally {
      setIsSelectingFolder(false);
    }
  };

  React.useEffect(() => {
    if (open) {
      const loadContainerFolder = async () => {
        try {
          const response = await new Promise<{ folder: chrome.bookmarks.BookmarkTreeNode | null }>((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'GET_TAB_GROUPS_FOLDER' }, response => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else if (response.error) {
                reject(new Error(response.error));
              } else {
                resolve(response);
              }
            });
          });
          setContainerFolder(response.folder);
        } catch (error) {
          logger.error('settings:loadTabGroupFolder:failed', {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      };
      loadContainerFolder();
    }
  }, [open, logger]);

  return (
    <>
      <Box sx={{ position: 'absolute', top: 12, right: 24 }}>
        <Tooltip title="Settings">
          <IconButton 
            onClick={() => setOpen(true)}
            size="small"
            sx={{ 
              padding: '6px',
              '& .MuiSvgIcon-root': {
                fontSize: '1.2rem'
              }
            }}
          >
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            maxHeight: '80vh'
          }
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          Settings
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Box sx={{ position: 'relative' }}>
            {error && (
              <Typography 
                color="error" 
                variant="caption" 
                sx={{ 
                  display: 'block', 
                  mb: 2,
                  mt: -1
                }}
              >
                {error}
              </Typography>
            )}

            {/* Location Settings */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary' }}>
                Container Location
              </Typography>
              {containerFolder ? (
                <Box>
                  <LocationDisplay folder={containerFolder} />
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={isSelectingFolder}
                    onClick={() => setShowFolderPicker(true)}
                  >
                    {isSelectingFolder ? (
                      <CircularProgress size={16} sx={{ mx: 1 }} />
                    ) : (
                      'Change Location'
                    )}
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    This container has two folders:
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 2 }}>
                    • "Tab Group Bookmarks" - contains your synced tab groups
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 2 }}>
                    • "Tab Group Snapshots" - contains your saved snapshots
                  </Typography>
                </Box>
              ) : (
                <Box>
                  <Button
                    size="small"
                    variant="contained"
                    color="primary"
                    disabled={isSelectingFolder}
                    onClick={() => setShowFolderPicker(true)}
                  >
                    {isSelectingFolder ? (
                      <CircularProgress size={16} sx={{ mx: 1 }} />
                    ) : (
                      'Select Location'
                    )}
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    Select a container location where we'll create:
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 2 }}>
                    • "Tab Group Bookmarks" folder for your synced tab groups
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 2 }}>
                    • "Tab Group Snapshots" folder for your saved snapshots
                  </Typography>
                </Box>
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Sync Settings */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary' }}>
                Sync Settings
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={autoSync}
                    onChange={handleAutoSyncChange}
                    size="small"
                    disabled={!containerFolder}
                  />
                }
                label={
                  <Typography variant="body2">
                    Enable automatic sync
                  </Typography>
                }
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, ml: 4 }}>
                {containerFolder 
                  ? "When enabled, new tab groups will automatically start syncing. You can still manually control sync for each group."
                  : "Select a container folder first to enable sync"}
              </Typography>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Cleanup Settings */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary' }}>
                Cleanup Settings
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={cleanupEnabled}
                    onChange={async (event) => {
                      const enabled = event.target.checked;
                      try {
                        await new Promise((resolve, reject) => {
                          chrome.runtime.sendMessage(
                            { 
                              type: 'UPDATE_SETTINGS', 
                              settings: { 
                                cleanup: {
                                  enabled,
                                  inactiveThreshold,
                                  autoArchive: true,
                                  deleteThreshold: 90
                                }
                              } 
                            },
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
                        setCleanupEnabled(enabled);
                        logger.info('settings:cleanup:updated', { enabled });
                      } catch (error) {
                        logger.error('settings:cleanup:updateFailed', {
                          error: error instanceof Error ? error.message : 'Unknown error'
                        });
                      }
                    }}
                    size="small"
                  />
                }
                label={
                  <Typography variant="body2">
                    Auto-remove inactive groups
                  </Typography>
                }
              />
              <Box sx={{ px: 4, mt: 2, ...(cleanupEnabled ? {} : { opacity: 0.5 }) }}>
                <Slider
                  value={inactiveThreshold}
                  onChange={(_, value) => setInactiveThreshold(value as number)}
                  onChangeCommitted={async (_, value) => {
                    try {
                      await new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage(
                          { 
                            type: 'UPDATE_SETTINGS', 
                            settings: { 
                              cleanup: {
                                enabled: cleanupEnabled,
                                inactiveThreshold: value as number,
                                autoArchive: true,
                                deleteThreshold: 90
                              }
                            } 
                          },
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
                      logger.info('settings:cleanup:thresholdUpdated', { threshold: value });
                    } catch (error) {
                      logger.error('settings:cleanup:thresholdUpdateFailed', {
                        error: error instanceof Error ? error.message : 'Unknown error'
                      });
                    }
                  }}
                  disabled={!cleanupEnabled}
                  min={7}
                  max={90}
                  step={1}
                  marks={[
                    { value: 7, label: '1w' },
                    { value: 30, label: '1m' },
                    { value: 60, label: '2m' },
                    { value: 90, label: '3m' }
                  ]}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${value} days`}
                  sx={{ width: '100%' }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, ml: 4 }}>
                Remove groups that haven't been seen for {inactiveThreshold} days
              </Typography>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Path Mappings for file:// sync */}
            <Box sx={{ mb: 3 }}>
              <Typography
                variant="subtitle2"
                sx={{ mb: 1.5, color: 'text.secondary', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setPathMappingsExpanded(!pathMappingsExpanded)}
              >
                {pathMappingsExpanded ? '▾' : '▸'} Path Mappings (file:// sync)
              </Typography>
              {pathMappingsExpanded && (
                <Box sx={{ ml: 1 }}>
                  <Box sx={{ mb: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      Machine ID
                    </Typography>
                    <input
                      type="text"
                      value={machineId}
                      onChange={e => setMachineId(e.target.value)}
                      placeholder="e.g., linux-home, macbook-work"
                      style={{
                        width: '100%', padding: '6px 8px', fontSize: '13px',
                        border: '1px solid #dadce0', borderRadius: '4px',
                        fontFamily: 'inherit', background: 'transparent', color: 'inherit'
                      }}
                    />
                  </Box>
                  {mappingRules.map((rule, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 0.5, mb: 0.75, alignItems: 'center' }}>
                      <input
                        type="text"
                        value={rule.canonicalPrefix}
                        onChange={e => {
                          const updated = [...mappingRules];
                          updated[i] = { ...updated[i], canonicalPrefix: e.target.value };
                          setMappingRules(updated);
                        }}
                        placeholder="Canonical prefix"
                        style={{
                          flex: 1, padding: '4px 6px', fontSize: '12px',
                          border: '1px solid #dadce0', borderRadius: '4px',
                          fontFamily: 'monospace', background: 'transparent', color: 'inherit'
                        }}
                      />
                      <Typography variant="caption" sx={{ color: 'text.secondary', px: 0.25 }}>
                        {'→'}
                      </Typography>
                      <input
                        type="text"
                        value={rule.localPrefix}
                        onChange={e => {
                          const updated = [...mappingRules];
                          updated[i] = { ...updated[i], localPrefix: e.target.value };
                          setMappingRules(updated);
                        }}
                        placeholder="This machine's prefix"
                        style={{
                          flex: 1, padding: '4px 6px', fontSize: '12px',
                          border: '1px solid #dadce0', borderRadius: '4px',
                          fontFamily: 'monospace', background: 'transparent', color: 'inherit'
                        }}
                      />
                      <Button
                        size="small"
                        sx={{ minWidth: 24, p: 0, fontSize: '14px' }}
                        onClick={() => {
                          const updated = mappingRules.filter((_, j) => j !== i);
                          setMappingRules(updated);
                          savePathMappings(machineId, updated);
                        }}
                      >
                        {'✕'}
                      </Button>
                    </Box>
                  ))}
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setMappingRules([...mappingRules, { canonicalPrefix: '', localPrefix: '' }])}
                  >
                    + Add mapping
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    Map path prefixes so file:// bookmarks open correctly across machines.
                    The canonical prefix is what gets stored in bookmarks.
                  </Typography>

                  {isEdge && mappingRules.length > 0 && (
                    <Alert severity="warning" sx={{ mt: 1.5, fontSize: '12px' }}>
                      <strong>Edge Workspace warning:</strong> Edge shows file:// tabs as
                      "workspace unsupported" on remote machines. Closing these phantom
                      tabs will close the real tab on the source machine. Consider removing
                      file:// tab groups from Edge Workspaces.
                    </Alert>
                  )}

                  <Box sx={{ mt: 1.5 }}>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={async () => {
                        try {
                          const [syncData, localData] = await Promise.all([
                            chrome.storage.sync.get('state:pathMappings'),
                            chrome.storage.local.get('machineId')
                          ]);
                          const store = syncData['state:pathMappings'] as any;
                          const mid = localData.machineId as string;
                          const rules = (store?.machines?.[mid]?.rules || []) as Array<{canonicalPrefix: string; localPrefix: string}>;

                          // Find Tab Group Bookmarks folder
                          const tree = await chrome.bookmarks.getTree();
                          function findTGB(nodes: chrome.bookmarks.BookmarkTreeNode[]): chrome.bookmarks.BookmarkTreeNode | null {
                            for (const n of nodes) {
                              if (n.title === 'Tab Group Bookmarks' && !n.url) return n;
                              if (n.children) { const f = findTGB(n.children); if (f) return f; }
                            }
                            return null;
                          }
                          const tgb = findTGB(tree);
                          if (!tgb) { alert('No Tab Group Bookmarks folder found'); return; }

                          const allTabGroups = await chrome.tabGroups.query({});
                          const groupByName: Record<string, number> = {};
                          for (const g of allTabGroups) { if (g.title) groupByName[g.title] = g.id; }

                          const groups = await chrome.bookmarks.getChildren(tgb.id);
                          let totalOpened = 0;

                          for (const group of groups) {
                            if (group.url) continue;
                            const bms = await chrome.bookmarks.getChildren(group.id);
                            const fileUrls = bms.filter(b => b.url?.startsWith('file://'));
                            if (fileUrls.length === 0) continue;

                            let openUrls = new Set<string>();
                            if (groupByName[group.title]) {
                              const tabs = await chrome.tabs.query({ groupId: groupByName[group.title] });
                              openUrls = new Set(tabs.map(t => t.url || ''));
                            }

                            const created: chrome.tabs.Tab[] = [];
                            for (const bm of fileUrls) {
                              const resolved = localize(bm.url!, { machineId: '', rules });
                              if (openUrls.has(resolved)) continue;
                              const tab = await chrome.tabs.create({ url: resolved, active: false });
                              created.push(tab);
                            }

                            if (created.length > 0) {
                              const tabIds = created.map(t => t.id!).filter(Boolean);
                              if (groupByName[group.title]) {
                                await chrome.tabs.group({ tabIds, groupId: groupByName[group.title] });
                              } else {
                                const gid = await chrome.tabs.group({ tabIds });
                                await chrome.tabGroups.update(gid, { title: group.title, collapsed: true });
                              }
                              totalOpened += created.length;
                            }
                          }

                          alert(`Opened ${totalOpened} file tab(s) across all groups.`);
                        } catch (e) {
                          alert('Failed: ' + (e instanceof Error ? e.message : e));
                        }
                      }}
                    >
                      Open all file:// tabs from bookmarks
                    </Button>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Opens every file:// URL from all synced groups, with path mapping applied.
                    </Typography>
                  </Box>

                  {typeof chrome !== 'undefined' && chrome.extension?.isAllowedFileSchemeAccess && (
                    <FileAccessBanner />
                  )}
                </Box>
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Bookmark Folder Cleanup */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary' }}>
                Bookmark Folder Cleanup
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Scan for leftover bookmark folders from partial renames (e.g. "s", "sp" alongside "splunk").
                Any bookmarks inside will be merged into the full-name folder before removal.
              </Typography>

              {cruftResult && (
                <Alert
                  severity="success"
                  onClose={() => setCruftResult(null)}
                  sx={{ mb: 1.5 }}
                >
                  {cruftResult}
                </Alert>
              )}

              {cruftCandidates === null ? (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={cruftScanning ? <CircularProgress size={16} /> : <CleanupIcon />}
                  disabled={cruftScanning}
                  onClick={async () => {
                    setCruftScanning(true);
                    setCruftResult(null);
                    try {
                      const response = await new Promise<any>((resolve, reject) => {
                        chrome.runtime.sendMessage({ type: 'SCAN_PREFIX_CRUFT' }, r => {
                          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                          else if (r.error) reject(new Error(r.error));
                          else resolve(r);
                        });
                      });
                      const candidates = response.result?.candidates || [];
                      setCruftCandidates(candidates);
                      if (candidates.length === 0) {
                        setCruftResult('No leftover folders found.');
                        setCruftCandidates(null);
                      }
                    } catch (error) {
                      setCruftResult(null);
                      logger.error('cleanup:scanFailed', {
                        error: error instanceof Error ? error.message : 'Unknown',
                      });
                    } finally {
                      setCruftScanning(false);
                    }
                  }}
                >
                  Scan for leftovers
                </Button>
              ) : (
                <Box>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Found {cruftCandidates.length} leftover folder{cruftCandidates.length !== 1 ? 's' : ''}:
                  </Typography>
                  <Box
                    component="ul"
                    sx={{ m: 0, pl: 2, mb: 1.5, maxHeight: 150, overflowY: 'auto', fontSize: '13px' }}
                  >
                    {cruftCandidates.map(c => (
                      <li key={c.id}>
                        <strong>{c.title}</strong>
                        {c.bookmarkCount > 0 && (
                          <span> ({c.bookmarkCount} bookmark{c.bookmarkCount !== 1 ? 's' : ''} → {c.mergeTargetTitle})</span>
                        )}
                      </li>
                    ))}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      size="small"
                      variant="contained"
                      color="error"
                      startIcon={cruftCleaning ? <CircularProgress size={16} color="inherit" /> : <CleanupIcon />}
                      disabled={cruftCleaning}
                      onClick={async () => {
                        setCruftCleaning(true);
                        try {
                          const response = await new Promise<any>((resolve, reject) => {
                            chrome.runtime.sendMessage(
                              { type: 'EXECUTE_PREFIX_CRUFT_CLEANUP', candidates: cruftCandidates },
                              r => {
                                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                                else if (r.error) reject(new Error(r.error));
                                else resolve(r);
                              }
                            );
                          });
                          const { mergedUrls, deletedFolders } = response.result;
                          setCruftResult(
                            `Cleaned up ${deletedFolders} folder${deletedFolders !== 1 ? 's' : ''}` +
                            (mergedUrls > 0 ? `, merged ${mergedUrls} bookmark${mergedUrls !== 1 ? 's' : ''}` : '')
                          );
                          setCruftCandidates(null);
                        } catch (error) {
                          logger.error('cleanup:executeFailed', {
                            error: error instanceof Error ? error.message : 'Unknown',
                          });
                        } finally {
                          setCruftCleaning(false);
                        }
                      }}
                    >
                      Delete {cruftCandidates.length} folder{cruftCandidates.length !== 1 ? 's' : ''}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setCruftCandidates(null)}
                    >
                      Cancel
                    </Button>
                  </Box>
                </Box>
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Export / Import */}
            <Box sx={{ mb: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary' }}>
                Export & Import
              </Typography>

              {exportImportStatus && (
                <Alert
                  severity={exportImportStatus.type}
                  onClose={() => setExportImportStatus(null)}
                  sx={{ mb: 1.5 }}
                >
                  {exportImportStatus.message}
                </Alert>
              )}

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ExportIcon />}
                  onClick={async () => {
                    try {
                      const response = await new Promise<{ data?: any; error?: string }>((resolve, reject) => {
                        chrome.runtime.sendMessage({ type: 'EXPORT_DATA' }, response => {
                          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                          else resolve(response);
                        });
                      });
                      if (response.error) throw new Error(response.error);

                      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `tab-group-sync-backup-${new Date().toISOString().slice(0, 10)}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      setExportImportStatus({ type: 'success', message: `Exported ${response.data.groups.length} group(s)` });
                    } catch (error) {
                      setExportImportStatus({ type: 'error', message: error instanceof Error ? error.message : 'Export failed' });
                    }
                  }}
                >
                  Export
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ImportIcon />}
                  disabled={!containerFolder}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Import
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const data = JSON.parse(text);
                      const response = await new Promise<{ success?: boolean; imported?: number; error?: string }>((resolve, reject) => {
                        chrome.runtime.sendMessage({ type: 'IMPORT_DATA', data }, response => {
                          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                          else resolve(response);
                        });
                      });
                      if (response.error) throw new Error(response.error);
                      setExportImportStatus({ type: 'success', message: `Imported ${response.imported} group(s)` });
                    } catch (error) {
                      setExportImportStatus({
                        type: 'error',
                        message: error instanceof Error ? error.message : 'Import failed — invalid file format',
                      });
                    }
                    // Reset file input
                    e.target.value = '';
                  }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Export your tab groups as JSON. Useful before uninstalling or for sharing across profiles.
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} size="small">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <FolderPicker
        open={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelect={handleFolderSelect}
      />
    </>
  );
}
