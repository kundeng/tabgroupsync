import React from 'react';
import { Box, Typography } from '@mui/material';

function App() {
  return (
    <Box sx={{ 
      minHeight: '100vh',
      bgcolor: 'grey.100',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <Typography>Start prompting (or editing) to see magic happen :)</Typography>
    </Box>
  );
}

export default App;
