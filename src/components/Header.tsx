import React from 'react';
import { Typography, Box, IconButton, Tooltip } from '@mui/material';
import ExtensionIcon from '@mui/icons-material/Extension';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import HelpDialog from './HelpDialog';

export default function Header() {
  const [helpOpen, setHelpOpen] = React.useState(false);

  return (
    <Box 
      sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 1, 
        mb: 1.5,
        '& .MuiSvgIcon-root': {
          fontSize: '1.5rem'
        }
      }}
    >
      <ExtensionIcon color="primary" />
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography 
          variant="h6" 
          component="h1"
          sx={{
            fontSize: '1.1rem',
            fontWeight: 600,
            lineHeight: 1.2
          }}
        >
          Tab Group Sync
        </Typography>
        <Tooltip title="Help & Information">
          <IconButton
            onClick={() => setHelpOpen(true)}
            size="small"
            color="primary"
            sx={{ 
              padding: '4px',
              '& .MuiSvgIcon-root': {
                fontSize: '1.1rem'
              }
            }}
          >
            <HelpOutlineIcon />
          </IconButton>
        </Tooltip>
      </Box>
      <HelpDialog 
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </Box>
  );
}
