import React from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
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
      <div style={{ width: '400px', padding: '16px' }}>
        <Header />
        <Settings storage={storage} syncEngine={syncEngine} />
        <GroupList storage={storage} syncEngine={syncEngine} />
        <SyncStatus storage={storage} />
      </div>
    </ThemeProvider>
  );
}
