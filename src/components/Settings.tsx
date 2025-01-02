import React from 'react';
import {
  Box,
  Typography,
  FormControlLabel,
  Switch,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Alert,
  CircularProgress,
} from '@mui/material';
import { ExpandMore, ChevronRight, Close as CloseIcon, Folder as FolderIcon } from '@mui/icons-material';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncEngine } from '../lib/sync/syncEngine';
import { GlobalSettings } from '../lib/types/storage';

interface SettingsProps {
  storage: StorageManager;
  syncEngine: SyncEngine;
}

interface BookmarkNode extends chrome.bookmarks.BookmarkTreeNode {
  children?: BookmarkNode[];
}

const findNode = (nodes: BookmarkNode[], nodeId: string): BookmarkNode | null => {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.children) {
      const found = findNode(node.children, nodeId);
      if (found) return found;
    }
  }
  return null;
};

export default function Settings({ storage, syncEngine }: SettingsProps) {
  const [settings, setSettings] = React.useState<GlobalSettings | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = React.useState(false);
  const [bookmarkTree, setBookmarkTree] = React.useState<BookmarkNode[]>([]);
  const [currentFolder, setCurrentFolder] = React.useState<string>('');
  const [error, setError] = React.useState<string>('');
  const [loading, setLoading] = React.useState(false);
  const [expandedNodes, setExpandedNodes] = React.useState<Set<string>>(new Set(['0', '1']));

  // Load settings
  React.useEffect(() => {
    const loadSettings = async () => {
      const settings = await storage.getSettings();
      setSettings(settings);
      if (settings.parentFolderId) {
        chrome.bookmarks.get(settings.parentFolderId, ([folder]) => {
          if (folder) {
            setCurrentFolder(folder.title);
          }
        });
      }
    };
    loadSettings();
  }, [storage]);

  const checkBookmarkPermissions = React.useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      chrome.permissions.contains(
        { permissions: ['bookmarks'] },
        (hasPermission) => {
          resolve(hasPermission);
        }
      );
    });
  }, []);

  const loadBookmarkTree = React.useCallback(async () => {
    setLoading(true);
    setError('');
    console.log('Loading bookmark tree...');

    const hasPermission = await checkBookmarkPermissions();
    if (!hasPermission) {
      setLoading(false);
      setError('Bookmark access required. Click "Fix Permissions" to enable access.');
      return;
    }

    try {
      chrome.bookmarks.getTree((tree) => {
        setLoading(false);
        console.log('Bookmark tree loaded:', tree);
        if (chrome.runtime.lastError) {
          console.error('Chrome runtime error:', chrome.runtime.lastError);
          setError('Failed to access bookmarks. Click "Fix Permissions" to enable access.');
          return;
        }
        if (!tree || tree.length === 0) {
          console.error('No bookmark tree data received');
          setError('Failed to load bookmarks. Click "Retry" to try again.');
          return;
        }
        setBookmarkTree(tree);
        setError('');
      });
    } catch (err) {
      setLoading(false);
      console.error('Bookmark access error:', err);
      setError('Bookmark access required. Click "Fix Permissions" to enable access.');
    }
  }, []);

  // Load bookmark tree when folder picker opens
  React.useEffect(() => {
    if (folderPickerOpen) {
      loadBookmarkTree();
    }
  }, [folderPickerOpen, loadBookmarkTree]);

  const handleAutoSyncChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newSettings = { ...settings!, autoSync: event.target.checked };
    await storage.updateSettings(newSettings);
    setSettings(newSettings);
    if (newSettings.autoSync) {
      await syncEngine.syncAll();
    }
  };

  const handleFolderSelect = async (folderId: string, title: string) => {
    await storage.updateSettings({ parentFolderId: folderId });
    setCurrentFolder(title);
    setFolderPickerOpen(false);
    const newSettings = await storage.getSettings();
    setSettings(newSettings);
    if (newSettings.autoSync) {
      await syncEngine.syncAll();
    }
  };

  const renderTree = (node: BookmarkNode) => {
    console.log('Rendering node:', node);
    // Skip non-folder items
    if (node.url) {
      console.log('Skipping URL node:', node.title);
      return null;
    }

    return (
      <Box key={node.id}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            p: 0.5,
            cursor: 'pointer',
            '&:hover': {
              bgcolor: 'action.hover',
            },
          }}
        >
          {node.children && node.children.length > 0 && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedNodes(prev => {
                  const next = new Set(prev);
                  if (next.has(node.id)) {
                    next.delete(node.id);
                  } else {
                    next.add(node.id);
                  }
                  return next;
                });
              }}
              sx={{ p: 0.5, mr: 0.5 }}
            >
              {expandedNodes.has(node.id) ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
            </IconButton>
          )}
          <Box
            onClick={() => handleFolderSelect(node.id, node.title)}
            sx={{ display: 'flex', alignItems: 'center', flex: 1 }}
          >
            <FolderIcon color="action" fontSize="small" sx={{ mr: 1 }} />
            <Typography variant="body2">{node.title || 'Unnamed Folder'}</Typography>
          </Box>
        </Box>
        {node.children && node.children.length > 0 && expandedNodes.has(node.id) && (
          <Box sx={{ pl: 3 }}>
            {node.children.map((child) => renderTree(child))}
          </Box>
        )}
      </Box>
    );
  };

  if (!settings) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Settings
      </Typography>
      
      <FormControlLabel
        control={
          <Switch
            checked={settings.autoSync}
            onChange={handleAutoSyncChange}
            color="primary"
          />
        }
        label="Auto-sync tab groups"
      />

      <Box sx={{ mt: 2 }}>
        <Button
          variant="outlined"
          onClick={() => setFolderPickerOpen(true)}
          fullWidth
          sx={{ mb: 1 }}
        >
          Select Parent Folder
        </Button>
        <Typography variant="body2" color="text.secondary">
          {currentFolder ? `Current: ${currentFolder}` : 'No folder selected'}
        </Typography>
      </Box>

      <Dialog
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            minHeight: '400px',
            maxHeight: '600px'
          }
        }}
      >
        <DialogTitle sx={{ m: 0, p: 2, pb: 1 }}>
          Select Parent Folder
          <IconButton
            onClick={() => setFolderPickerOpen(false)}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: 'text.secondary'
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 2 }}>
          {loading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 4 }}>
              <CircularProgress size={24} />
              <Typography color="text.secondary">Loading bookmarks...</Typography>
            </Box>
          ) : error ? (
            <Box>
              <Alert 
                severity="error" 
                sx={{ mb: 2 }}
                action={
                  error.includes('permissions') ? (
                    <Button 
                      color="inherit" 
                      size="small"
                      onClick={() => chrome.runtime.openOptionsPage()}
                    >
                      Fix Permissions
                    </Button>
                  ) : (
                    <Button 
                      color="inherit" 
                      size="small"
                      onClick={loadBookmarkTree}
                    >
                      Retry
                    </Button>
                  )
                }
              >
                {error}
              </Alert>
            </Box>
          ) : (
            <Box sx={{ 
              minHeight: 240,
              flexGrow: 1,
              maxWidth: '100%',
              overflowY: 'auto',
              pl: 2
            }}>
              {bookmarkTree.map(renderTree)}
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
