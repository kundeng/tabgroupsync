import React from 'react';
import { Typography, Box } from '@mui/material';
import ExtensionIcon from '@mui/icons-material/Extension';

export default function Header() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
      <ExtensionIcon color="primary" />
      <Typography variant="h6" component="h1">
        Tab Group Sync
      </Typography>
    </Box>
  );
}
