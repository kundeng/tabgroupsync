import React from 'react';
import { 
  ThemeProvider, 
  createTheme, 
  CssBaseline, 
  Box,
  CircularProgress,
  Typography
} from '@mui/material';
import { StorageManager } from '../lib/storage/storageManager';
import { SyncEngine } from '../lib/sync/syncEngine';
import { BookmarkManager } from '../lib/bookmarks/bookmarkManager';
import { TabGroupManager } from '../lib/tabGroupManager';
import Header from './Header';
import Settings from './Settings';
import GroupList from './GroupList';
import SyncStatus from './SyncStatus';
import { Logger } from '../lib/utils/logger';

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
  const [isInitialized, setIsInitialized] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  const [managers, setManagers] = React.useState<{
    storage: StorageManager;
    bookmarkManager: BookmarkManager;
    syncEngine: SyncEngine;
    tabGroupManager: TabGroupManager;
  } | null>(null);
  const logger = Logger.getInstance();

  React.useEffect(() => {
    const init = async () => {
      try {
        // Wait for background service to be ready
        const port = chrome.runtime.connect({ name: 'popup' });
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Background service connection timeout'));
          }, 5000);

          const messageHandler = (message: { type: string; error?: string }) => {
            if (message.type === 'PONG') {
              cleanup();
              resolve(undefined);
            } else if (message.type === 'NOT_READY') {
              cleanup();
              reject(new Error(message.error || 'Background service not ready'));
            }
          };

          const cleanup = () => {
            clearTimeout(timeout);
            port.onMessage.removeListener(messageHandler);
          };

          port.onMessage.addListener(messageHandler);
          port.postMessage({ type: 'PING' });
        });

        // Create message-based managers
        const storage: StorageManager = {
          getSettings: async () => {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, response => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response.error) {
                  reject(new Error(response.error));
                } else {
                  resolve(response.settings);
                }
              });
            });
          },
          updateSettings: async (settings) => {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings }, response => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response.error) {
                  reject(new Error(response.error));
                } else {
                  resolve();
                }
              });
            });
          },
          getHistory: async () => {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, response => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response.error) {
                  reject(new Error(response.error));
                } else {
                  resolve(response.history);
                }
              });
            });
          }
        } as StorageManager;

        const bookmarkManager: BookmarkManager = {
          getTabGroupsFolder: async () => {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'GET_TAB_GROUPS_FOLDER' }, response => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response.error) {
                  reject(new Error(response.error));
                } else {
                  resolve(response.folder);
                }
              });
            });
          },
          setupTabGroupsFolder: async (containerFolder) => {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'SETUP_TAB_GROUPS_FOLDER', containerFolder }, response => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response.error) {
                  reject(new Error(response.error));
                } else {
                  resolve(response.folder);
                }
              });
            });
          }
        } as BookmarkManager;

        const syncEngine: SyncEngine = {
          syncAll: async () => {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'SYNC_ALL' }, response => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response.error) {
                  reject(new Error(response.error));
                } else {
                  resolve();
                }
              });
            });
          },
          syncGroupToFolder: async (name) => {
            return new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'SYNC_GROUP', name }, response => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response.error) {
                  reject(new Error(response.error));
                } else {
                  resolve();
                }
              });
            });
          }
        } as SyncEngine;

        const tabGroupManager = {} as TabGroupManager; // Not needed in popup

        setManagers({
          storage,
          bookmarkManager,
          syncEngine,
          tabGroupManager
        });
        setIsInitialized(true);

        logger.info('popup:initialized', {
          hasStorage: !!storage,
          hasBookmarkManager: !!bookmarkManager,
          hasSyncEngine: !!syncEngine,
          hasTabGroupManager: !!tabGroupManager
        });
      } catch (error) {
        logger.error('popup:initialization:failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        setError(error instanceof Error ? error : new Error('Failed to initialize'));
      }
    };

    void init();
  }, [logger]);

  if (!isInitialized || !managers) {
    return (
      <Box sx={{ 
        display: 'flex', 
        flexDirection: 'column',
        alignItems: 'center', 
        justifyContent: 'center',
        height: '100vh',
        gap: 2
      }}>
        {error ? (
          <Typography color="error" variant="body2">
            {error.message}
          </Typography>
        ) : (
          <>
            <CircularProgress size={24} />
            <Typography color="text.secondary" variant="body2">
              Initializing...
            </Typography>
          </>
        )}
      </Box>
    );
  }

  const { storage, bookmarkManager, syncEngine } = managers;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box 
        sx={{
          width: '480px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <Box sx={{ px: 3, pt: 2, pb: 1 }}>
          <Header />
          <Settings storage={storage} syncEngine={syncEngine} bookmarkManager={bookmarkManager} />
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
          <GroupList storage={storage} syncEngine={syncEngine} bookmarkManager={bookmarkManager} />
        </Box>
        <Box sx={{ px: 3, py: 1, borderTop: 1, borderColor: 'divider', position: 'relative' }}>
          <SyncStatus storage={storage} />
        </Box>
      </Box>
    </ThemeProvider>
  );
}
