import React from 'react';
import { ThemeProvider, createTheme, CssBaseline, Box } from '@mui/material';
import { TreeView } from '@mui/lab';
import { ExpandMore, ChevronRight } from '@mui/icons-material';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncEngine } from '../lib/sync/syncEngine';
import { BookmarkManager } from '../lib/bookmarkManager';
import { TabGroupManager } from '../lib/tabGroupManager';
import Header from './Header';
import Settings from './Settings';
import GroupList from './GroupList';
import SyncStatus from './SyncStatus';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1a73e8',
    },
    background: {
      default: '#ffffff',
      paper: '#ffffff',
    },
  },
  typography: {
    fontSize: 14,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
        },
      },
    },
    MuiListItem: {
      styleOverrides: {
        root: {
          paddingTop: 8,
          paddingBottom: 8,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          padding: 6,
        },
      },
    },
  },
});

export default function App() {
  const [initialized, setInitialized] = React.useState(false);
  const [storage] = React.useState(() => new StorageManager());
  const [bookmarkManager] = React.useState(() => new BookmarkManager(storage));
  const [tabGroupManager] = React.useState(() => new TabGroupManager(bookmarkManager));
  const [syncEngine] = React.useState(() => 
    new SyncEngine(storage, bookmarkManager, tabGroupManager)
  );

  React.useEffect(() => {
    const init = async () => {
      await storage.loadState();
      setInitialized(true);
    };
    init();
  }, [storage]);

  if (!initialized) {
    return null;
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box 
        sx={{
          width: '480px',
          height: '100vh',
          maxHeight: '600px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <Box sx={{ px: 3, pt: 2, pb: 1 }}>
          <Header />
          <Settings storage={storage} syncEngine={syncEngine} />
        </Box>
        <Box 
          sx={{ 
            flex: 1,
            overflowY: 'auto',
            px: 3,
            pb: 2,
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              background: '#bbb',
              borderRadius: '4px',
              '&:hover': {
                background: '#999',
              },
            },
          }}
        >
          <GroupList storage={storage} syncEngine={syncEngine} />
        </Box>
        <Box sx={{ px: 3, py: 1, borderTop: 1, borderColor: 'divider' }}>
          <SyncStatus storage={storage} />
        </Box>
      </Box>
    </ThemeProvider>
  );
}
