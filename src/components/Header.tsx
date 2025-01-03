import React from 'react';
import { Typography, Box } from '@mui/material';
import ExtensionIcon from '@mui/icons-material/Extension';

export default function Header() {
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
    </Box>
  );
}
