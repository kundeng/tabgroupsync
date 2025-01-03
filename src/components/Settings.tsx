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
} from '@mui/material';
import FolderPicker from './FolderPicker';
import { Settings as SettingsIcon } from '@mui/icons-material';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncEngine } from '../lib/sync/syncEngine';
import { BookmarkManager } from '../lib/bookmarkManager';
import { Logger } from '../lib/utils/logger';

interface SettingsProps {
  storage: StorageManager;
  syncEngine: SyncEngine;
}

export default function Settings({ storage, syncEngine }: SettingsProps) {
  const [open, setOpen] = React.useState(false);
  const [autoSync, setAutoSync] = React.useState(false);
  const [parentFolder, setParentFolder] = React.useState<chrome.bookmarks.BookmarkTreeNode | null>(null);
  const [isSelectingFolder, setIsSelectingFolder] = React.useState(false);
  const [showFolderPicker, setShowFolderPicker] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const logger = Logger.getInstance();
  const bookmarkManager = React.useMemo(() => new BookmarkManager(storage), [storage]);

  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await storage.getSettings();
        setAutoSync(settings.autoSync);
        
        if (settings.parentFolderId) {
          const folder = await bookmarkManager.getParentFolder();
          setParentFolder(folder);
        }
      } catch (error) {
        logger.error('settings:load:failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Keep default false state on error
      }
    };
    loadSettings();

    // Subscribe to settings changes
    const unsubscribe = storage.subscribe((event) => {
      if (event.type === 'settings-changed' && event.data.settings) {
        setAutoSync(event.data.settings.autoSync);
      }
    });

    return unsubscribe;
  }, [storage, logger, bookmarkManager]);

  const handleAutoSyncChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked;
    try {
      await storage.updateSettings({ autoSync: enabled });
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
            const folder = await bookmarkManager.setParentFolder(selectedFolder);
      await storage.updateSettings({ parentFolderId: folder.id });
      setParentFolder(folder);
            logger.info('settings:parentFolder:selected', { folderId: folder.id });
      setShowFolderPicker(false);
    } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to set parent folder';
      if (!message.includes('cancelled')) {
        setError(message);
            logger.error('settings:parentFolder:selectFailed', { error: message });
      }
    } finally {
      setIsSelectingFolder(false);
    }
  };

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
            <Box sx={{ mb: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={autoSync}
                    onChange={handleAutoSyncChange}
                    size="small"
                  />
                }
                label={
                  <Typography variant="body2">
                    Automatically sync tab groups to bookmarks
                  </Typography>
                }
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, ml: 4 }}>
                When enabled, changes to tab groups will be automatically backed up to bookmarks
              </Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              {parentFolder ? (
                <Box>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Parent Folder: {parentFolder.title}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={isSelectingFolder}
                    onClick={() => setShowFolderPicker(true)}
                  >
                    {isSelectingFolder ? (
                      <CircularProgress size={16} sx={{ mx: 1 }} />
                    ) : (
                      'Change Parent Folder'
                    )}
                  </Button>
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
                      'Select Parent Folder'
                    )}
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    Choose where to store your tab group bookmarks
                  </Typography>
                </Box>
              )}
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
