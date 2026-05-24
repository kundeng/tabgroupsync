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
  Divider,
  Link,
} from '@mui/material';
import FavoriteIcon from '@mui/icons-material/Favorite';
import ShieldIcon from '@mui/icons-material/Shield';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function HelpDialog({ open, onClose }: HelpDialogProps) {
  const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version
    : '';

  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      maxWidth="md"
      fullWidth
      scroll="paper"
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Help & Information
        {version && (
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 400 }}>
            v{version}
          </Typography>
        )}
      </DialogTitle>
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

        <Divider sx={{ my: 2 }} />

        <Box sx={{
          bgcolor: 'action.hover',
          borderRadius: 2,
          p: 2,
          mb: 1,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <ShieldIcon color="success" fontSize="small" />
            <Typography variant="h6" sx={{ fontSize: '1rem' }}>
              Why Tab Group Sync?
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Unlike other tab managers that require accounts and send your browsing data to external servers,
            Tab Group Sync keeps everything 100% in your browser.
          </Typography>
          <Box component="ul" sx={{ pl: 2.5, m: 0 }}>
            <Typography component="li" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              <strong>No accounts</strong> — no sign-ups, no logins, ever
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              <strong>No servers</strong> — your data never leaves your browser
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              <strong>No tracking</strong> — zero analytics, telemetry, or fingerprinting
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              <strong>No subscriptions</strong> — all features free, no paywalls
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary">
              <strong>Cross-device sync</strong> — through Chrome's built-in bookmark sync, using your own Google account
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
          <TipsAndUpdatesIcon color="primary" fontSize="small" sx={{ mt: 0.25 }} />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
              Pro Tip: Search your backed-up groups
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Pair with{' '}
              <Link
                href="https://github.com/Fannon/search-bookmarks-history-and-tabs"
                target="_blank"
                rel="noopener noreferrer"
              >
                Search Bookmarks, History and Tabs
              </Link>
              {' '}for powerful search across all your backed-up tab groups. It's a perfect companion extension.
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box>
          <Typography variant="h6" gutterBottom>
            Support Development
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tab Group Sync is free and open source. If you find it useful, consider supporting
            its continued development.
          </Typography>
          <Button
            variant="outlined"
            size="small"
            href="https://www.paypal.com/ncp/payment/ED8J8ALQYKRMA"
            target="_blank"
            rel="noopener noreferrer"
            startIcon={<FavoriteIcon sx={{ color: '#e91e63' }} />}
            sx={{ mt: 1.5, textTransform: 'none' }}
          >
            Donate via PayPal
          </Button>
        </Box>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        <Link
          href="https://www.paypal.com/ncp/payment/ED8J8ALQYKRMA"
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            fontSize: '0.85rem',
            color: 'text.secondary',
            '&:hover': { color: 'primary.main' },
          }}
        >
          <FavoriteIcon sx={{ fontSize: '0.95rem', color: '#e91e63' }} />
          Support this project
        </Link>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
