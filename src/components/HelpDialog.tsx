import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
  Divider
} from '@mui/material';

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function HelpDialog({ open, onClose }: HelpDialogProps) {
  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      maxWidth="md"
      fullWidth
      scroll="paper"
    >
      <DialogTitle>Help & Information</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Key Concepts
          </Typography>
          <List>
            <ListItem>
              <ListItemText
                primary="Container Folder"
                secondary="A dedicated bookmark folder that stores all your tab group backups. You can select this location in the settings."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Tab Groups"
                secondary="Chrome's built-in feature to organize related tabs together. Each group can be backed up to a bookmark folder."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Backup Location"
                secondary="Each tab group gets its own folder inside the container folder. This preserves your tabs even when the group is closed."
              />
            </ListItem>
          </List>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Sync Features
          </Typography>
          <List>
            <ListItem>
              <ListItemText
                primary="Auto-Sync New Groups"
                secondary="When enabled, newly created tab groups will automatically start syncing to bookmarks. You can enable this in settings."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Sync Frequency"
                secondary="Tab groups are synced periodically based on your settings, with a minimum interval of 5 minutes to avoid hitting Chrome's API limits."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Snapshots"
                secondary="Create manual backups of your tab groups at any time. Useful before making major changes to your tabs."
              />
            </ListItem>
          </List>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box>
          <Typography variant="h6" gutterBottom>
            Tips & Best Practices
          </Typography>
          <List>
            <ListItem>
              <ListItemText
                primary="Name Your Groups"
                secondary="Give your tab groups descriptive names to easily identify them in your bookmarks."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Regular Backups"
                secondary="Use snapshots before making significant changes to your tab groups."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Clean Up"
                secondary="Remove old groups you no longer need to keep your bookmarks organized."
              />
            </ListItem>
          </List>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
