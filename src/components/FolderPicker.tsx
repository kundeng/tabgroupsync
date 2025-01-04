import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  CircularProgress,
  Box,
  Typography,
} from '@mui/material';
import { Folder as FolderIcon, ChevronRight } from '@mui/icons-material';

interface FolderPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (folder: chrome.bookmarks.BookmarkTreeNode) => void;
}

export default function FolderPicker({ open, onClose, onSelect }: FolderPickerProps) {
  const [loading, setLoading] = React.useState(true);
  const [folders, setFolders] = React.useState<chrome.bookmarks.BookmarkTreeNode[]>([]);
  const [currentPath, setCurrentPath] = React.useState<chrome.bookmarks.BookmarkTreeNode[]>([]);

  React.useEffect(() => {
    if (open) {
      setLoading(true);
      // Reset state when opening
      setFolders([]);
      setCurrentPath([]);
      chrome.bookmarks.getTree((tree) => {
        setFolders(tree[0].children || []);
        setCurrentPath([tree[0]]);
        setLoading(false);
      });
    }
  }, [open]);

  const refreshFolders = React.useCallback(() => {
    if (!currentPath.length) return;
    
    const parent = currentPath[currentPath.length - 1];
    chrome.bookmarks.getChildren(parent.id, (children) => {
      const subfolders = children.filter(node => !node.url);
      setFolders(subfolders);
    });
  }, [currentPath]);

  // Refresh folders when dialog is opened or current path changes
  React.useEffect(() => {
    if (open && currentPath.length > 0) {
      refreshFolders();
    }
  }, [open, currentPath, refreshFolders]);

  const handleFolderClick = async (folder: chrome.bookmarks.BookmarkTreeNode) => {
    setLoading(true);
    try {
      chrome.bookmarks.getChildren(folder.id, (children) => {
        const subfolders = children.filter(node => !node.url);
        setFolders(subfolders);
        setCurrentPath([...currentPath, folder]);
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNavigateUp = () => {
    if (currentPath.length > 1) {
      setLoading(true);
      try {
        const newPath = currentPath.slice(0, -1);
        const parent = newPath[newPath.length - 1];
        chrome.bookmarks.getChildren(parent.id, (children) => {
          const subfolders = children.filter(node => !node.url);
          setFolders(subfolders);
          setCurrentPath(newPath);
        });
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSelect = (folder: chrome.bookmarks.BookmarkTreeNode) => {
    // Close dialog first
    onClose();
    // Then handle selection
    onSelect(folder);
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '300px'
        }
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box>
          <Typography variant="h6" sx={{ fontSize: '1rem', mb: 0.5 }}>
            Select Container Folder
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {currentPath.map(f => f.title).join(' > ')}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0, minHeight: '300px' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <List dense>
              {currentPath.length > 1 && (
                <ListItemButton 
                  onClick={handleNavigateUp}
                  sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: 'action.hover'
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <FolderIcon fontSize="small" color="action" />
                  </ListItemIcon>
                  <ListItemText 
                    primary=".." 
                    secondary={currentPath[currentPath.length - 1].title}
                    primaryTypographyProps={{
                      variant: 'body2',
                      sx: { fontWeight: 500 }
                    }}
                    secondaryTypographyProps={{
                      variant: 'caption'
                    }}
                  />
                </ListItemButton>
              )}
              {folders.map((folder) => (
                <ListItemButton 
                  key={folder.id}
                  onClick={() => handleFolderClick(folder)}
                  onDoubleClick={() => handleSelect(folder)}
                  sx={{
                    '&:hover': {
                      bgcolor: 'action.hover',
                      '& .MuiSvgIcon-root.arrow': {
                        opacity: 1
                      }
                    }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <FolderIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText 
                    primary={folder.title} 
                    primaryTypographyProps={{
                      variant: 'body2',
                      sx: { fontWeight: 500 }
                    }}
                  />
                  <ChevronRight className="arrow" fontSize="small" sx={{ opacity: 0.3 }} />
                </ListItemButton>
              ))}
            </List>
            {folders.length === 0 && (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  No folders found
                </Typography>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">
          Cancel
        </Button>
        <Button 
          onClick={() => handleSelect(currentPath[currentPath.length - 1])}
          variant="contained"
          size="small"
          disabled={currentPath.length <= 1}
        >
          Select Current Folder
        </Button>
      </DialogActions>
    </Dialog>
  );
}
