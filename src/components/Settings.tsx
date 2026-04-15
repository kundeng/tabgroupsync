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
} from '@mui/icons-material';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncEngine } from '../lib/sync/syncEngine';
import { BookmarkManager } from '../lib/bookmarks/bookmarkManager';
import { Logger } from '../lib/utils/logger';
import LocationDisplay from './LocationDisplay';

interface SettingsProps {
  storage: StorageManager;
  syncEngine: SyncEngine;
  bookmarkManager: BookmarkManager;
}

export default function Settings({ storage, syncEngine, bookmarkManager }: SettingsProps) {
  const [open, setOpen] = React.useState(false);
  const [autoSync, setAutoSync] = React.useState(false);
  const [cleanupEnabled, setCleanupEnabled] = React.useState(false);
  const [inactiveThreshold, setInactiveThreshold] = React.useState(30);
  const [containerFolder, setContainerFolder] = React.useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [isSelectingFolder, setIsSelectingFolder] = React.useState(false);
  const [showFolderPicker, setShowFolderPicker] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [exportImportStatus, setExportImportStatus] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
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
