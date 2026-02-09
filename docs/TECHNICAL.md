# Tab Group Sync - Technical Documentation

This documentation serves two purposes:

1. Guide for beginners learning React and Chrome extension development
2. Technical reference for maintainers and contributors

## Table of Contents

### Part 1: Learning Guide

1. [Getting Started](#1-getting-started)
2. [Chrome Extension Basics](#2-chrome-extension-basics)
3. [React UI Development](#3-react-ui-development)
4. [State and Data Flow](#4-state-and-data-flow)
5. [Advanced Topics](#5-advanced-topics)

### Part 2: Technical Reference

6. [Architecture Overview](#6-architecture-overview)
7. [Core Components](#7-core-components)
8. [UI Components](#8-ui-components)
9. [State Management](#9-state-management)
10. [Communication Patterns](#10-communication-patterns)
11. [Error Handling &amp; Recovery](#11-error-handling--recovery)
12. [Performance Considerations](#12-performance-considerations)
13. [Security &amp; Privacy](#13-security--privacy)
14. [Development &amp; Testing](#14-development--testing)
15. [Extension Lifecycle](#15-extension-lifecycle)
16. [Storage Optimization Deep Dive](#16-storage-optimization-deep-dive)
17. [Help System Implementation](#17-help-system-implementation)
18. [Snapshot System Implementation](#18-snapshot-system-implementation)

## Part 1: Learning Guide

### 1. Getting Started

#### Prerequisites

- Node.js and npm installed
- Basic JavaScript/TypeScript knowledge
- Familiarity with React concepts
- Chrome browser for development

#### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build extension: `npm run build`
4. Load unpacked extension in Chrome

#### Project Structure

```
src/
├── components/    # React UI components
├── lib/          # Core functionality
│   ├── bookmarks/  # Bookmark operations
│   ├── storage/    # State management
│   ├── sync/       # Sync engine
│   ├── types/      # TypeScript types
│   └── utils/      # Utilities
├── listeners/    # Event listeners
└── background.ts # Service worker
```

### 2. Chrome Extension Basics

#### Manifest File

The manifest.json defines the extension:

```json
{
  "manifest_version": 3,
  "name": "Tab Group Sync",
  "version": "1.1.0",
  "permissions": [
    "tabs",
    "tabGroups",
    "bookmarks",
    "storage"
  ],
  "action": {
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  }
}
```

Key concepts:

- Manifest V3 is required
- Permissions must be explicit
- Popup UI is defined in HTML
- Background service runs separately

### 3. React UI Development

#### 3.1 Component Basics

React components in our extension:

```typescript
// Basic component with props
interface HeaderProps {
  onHelpClick: () => void;
}

function Header({ onHelpClick }: HeaderProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Typography>Tab Group Sync</Typography>
      <IconButton onClick={onHelpClick}>
        <HelpIcon />
      </IconButton>
    </Box>
  );
}

// Component with state
function GroupList() {
  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadGroups().catch(err => setError(err.message));
  }, []);

  return (
    <Box>
      {error && <Alert severity="error">{error}</Alert>}
      {groups.map(group => (
        <GroupItem key={group.id} group={group} />
      ))}
    </Box>
  );
}
```

### 4. State and Data Flow

#### 4.1 Component State

```typescript
// Local state
const [isOpen, setIsOpen] = useState(false);

// Derived state
const isValid = useMemo(() => {
  return validateInput(value);
}, [value]);

// Effect hooks
useEffect(() => {
  const handleStorageChange = (changes) => {
    if (changes.settings) {
      updateUI(changes.settings.newValue);
    }
  };
  
  chrome.storage.onChanged.addListener(handleStorageChange);
  return () => chrome.storage.onChanged.removeListener(handleStorageChange);
}, []);
```

#### 4.2 Props and Events

```typescript
interface GroupItemProps {
  group: TabGroup;
  onSync: (id: string) => void;
}

function GroupItem({ group, onSync }: GroupItemProps) {
  const handleClick = () => {
    onSync(group.id);
  };

  return (
    <ListItem>
      <ListItemText primary={group.name} />
      <IconButton onClick={handleClick}>
        <SyncIcon />
      </IconButton>
    </ListItem>
  );
}
```

### 5. Advanced Topics

#### 5.1 Chrome Extension APIs

```typescript
// Working with tab groups
const groups = await chrome.tabGroups.query({});
const tabs = await chrome.tabs.query({ groupId: group.id });

// Working with bookmarks
const folder = await chrome.bookmarks.create({
  parentId: '1',
  title: 'My Group'
});

// Storage operations
await chrome.storage.sync.set({ key: value });
const result = await chrome.storage.sync.get('key');
```

#### 5.2 TypeScript Integration

```typescript
// Type definitions
interface TabGroup {
  id: number;
  name: string;
  color: chrome.tabGroups.Color;
}

// Generic types
type Result<T> = {
  data?: T;
  error?: string;
};

// Type guards
function isTabGroup(obj: any): obj is TabGroup {
  return typeof obj === 'object'
    && typeof obj.id === 'number'
    && typeof obj.name === 'string';
}
```

#### 5.3 Material-UI Patterns

```typescript
// Theme customization
const theme = createTheme({
  palette: {
    primary: {
      main: '#1a73e8'
    }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none'
        }
      }
    }
  }
});

// Styled components
const StyledBox = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.background.paper
}));
```

## Part 2: Technical Reference

### 6. Architecture Overview

#### Design Philosophy

- Message-based communication
- Manager-based design pattern
- Reactive state management
- Clear separation of concerns

#### Core Architecture

```
UI Components (React)
      ↕
Message Passing Layer
      ↕
Background Service
  ↙     ↓     ↘
Storage  Chrome  Bookmark
Manager   APIs   Manager
```

#### Key Design Decisions

1. **Message-Based Communication**

   - UI never directly accesses Chrome APIs
   - Type-safe message passing
   - Centralized error handling
2. **Manager Pattern**

   ```typescript
   // Each manager handles specific functionality
   interface StorageManager {
     getSettings(): Promise<Settings>;
     updateSettings(settings: Settings): Promise<void>;
     getHistory(): Promise<SyncHistory>;
   }

   interface BookmarkManager {
     getTabGroupsFolder(): Promise<chrome.bookmarks.BookmarkTreeNode>;
     setupTabGroupsFolder(containerFolder: string): Promise<chrome.bookmarks.BookmarkTreeNode>;
   }

   interface SyncEngine {
     syncAll(): Promise<void>;
     syncGroupToFolder(name: string): Promise<void>;
   }
   ```
3. **Reactive Updates**

   ```typescript
   // Background updates trigger storage events
   chrome.storage.onChanged.addListener((changes) => {
     // UI components react to storage changes
     if (changes.settings) {
       updateUI(changes.settings.newValue);
     }
   });
   ```
4. **Error Recovery**

   ```typescript
   // Centralized error handling in background
   try {
     await operation();
   } catch (error) {
     // Log error
     logger.error('operation:failed', { error });
     // Notify UI
     sendResponse({ error: error.message });
     // Attempt recovery
     await recoveryStrategy();
   }
   ```

#### State Flow

1. User Action → UI Component
2. Component → Message → Background
3. Background → Operation → Result
4. Result → Storage Update
5. Storage Event → UI Update

### 7. Core Components

#### 7.1 Storage Manager

The StorageManager handles all state persistence:

```typescript
// src/lib/storage/storageManager.ts
export class StorageManager {
  private logger = Logger.getInstance();

  async getSettings(): Promise<Settings> {
    try {
      const result = await chrome.storage.sync.get('settings');
      return result.settings || DEFAULT_SETTINGS;
    } catch (error) {
      this.logger.error('settings:get:failed', { error });
      throw error;
    }
  }

  async updateSettings(settings: Settings): Promise<void> {
    try {
      await chrome.storage.sync.set({ settings });
      this.logger.info('settings:updated', { settings });
    } catch (error) {
      this.logger.error('settings:update:failed', { error });
      throw error;
    }
  }
}
```

Key responsibilities:

- State persistence
- Data validation
- Migration support
- Error handling

#### 7.2 Sync Engine

The SyncEngine coordinates tab group and bookmark synchronization:

```typescript
// src/lib/sync/syncEngine.ts
export class SyncEngine {
  private rateLimiter: RateLimiter;
  
  constructor(
    private storage: StorageManager,
    private bookmarks: BookmarkManager,
    private tabGroups: TabGroupManager
  ) {
    this.rateLimiter = new RateLimiter({
      maxOperations: 5,
      interval: 1000
    });
  }

  async syncGroupToFolder(name: string): Promise<void> {
    await this.rateLimiter.acquire();
    try {
      const group = await this.tabGroups.getGroup(name);
      const folder = await this.bookmarks.getGroupFolder(name);
      await this.syncTabs(group, folder);
    } finally {
      this.rateLimiter.release();
    }
  }

  private async syncTabs(
    group: chrome.tabGroups.TabGroup,
    folder: chrome.bookmarks.BookmarkTreeNode
  ): Promise<void> {
    // Implementation details...
  }
}
```

Key features:

- Rate limiting
- Two-way sync
- Conflict resolution
- Error recovery

### 8. UI Components

#### 8.1 Component Architecture

The UI follows a hierarchical structure with clear responsibilities:

```typescript
// src/components/App.tsx
export default function App() {
  // Core managers passed down through props
  const [managers, setManagers] = React.useState<{
    storage: StorageManager;
    bookmarkManager: BookmarkManager;
    syncEngine: SyncEngine;
    tabGroupManager: TabGroupManager;
  } | null>(null);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ width: '480px', height: '100%' }}>
        <Header />
        <Settings 
          storage={managers.storage}
          syncEngine={managers.syncEngine}
          bookmarkManager={managers.bookmarkManager}
        />
        <GroupList
          storage={managers.storage}
          syncEngine={managers.syncEngine}
          bookmarkManager={managers.bookmarkManager}
        />
        <SyncStatus storage={managers.storage} />
      </Box>
    </ThemeProvider>
  );
}
```

#### 8.2 Component Communication

Components communicate through:

1. Props for parent-child communication
2. Messages to background service
3. Storage events for state updates

Example of message handling:

```typescript
// In a component
const handleToggleSync = async (name: string) => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'TOGGLE_SYNC',
      name
    });
    if (response.error) {
      throw new Error(response.error);
    }
    // UI will update automatically via storage events
  } catch (error) {
    setError(error.message);
  }
};
```

#### 8.3 Error Boundaries

Error boundaries catch and handle component errors:

```typescript
// src/components/ErrorBoundary.tsx
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    Logger.getInstance().error('ui:error', {
      error: error.message,
      componentStack: info.componentStack
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 2, color: 'error.main' }}>
          <Typography variant="h6">Something went wrong</Typography>
          <Typography variant="body2">{this.state.error?.message}</Typography>
        </Box>
      );
    }
    return this.props.children;
  }
}
```

### 9. State Management

#### 9.1 Storage Architecture

The extension uses a layered storage approach with persisted settings as the source of truth:

```typescript
// Persisted settings (source of truth)
interface GroupSyncSettings {
  enabled: boolean;
  lastSynced: number;
}

// Runtime state (reflects persisted settings)
interface RuntimeMapping {
  name: string;
  folderId: string;
  syncEnabled: boolean;  // Always matches persisted settings
  status: {
    lastSynced: number;
    inProgress: boolean;
    error?: string;
  };
}

// Storage operations
class StorageManager {
  async getGroupSyncSettings(name: string): Promise<GroupSyncSettings> {
    // Get persisted settings (source of truth)
    const settings = await chrome.storage.sync.get(`pref:${name}`);
    return settings[`pref:${name}`] || { enabled: false, lastSynced: 0 };
  }

  async updateMapping(name: string, update: RuntimeMappingUpdate): Promise<void> {
    // Runtime state always reflects persisted settings
    const groupSettings = await this.getGroupSyncSettings(name);
    const mapping = {
      ...this.runtimeMappings[name],
      ...update,
      syncEnabled: groupSettings.enabled
    };
    this.runtimeMappings[name] = mapping;
  }
}
```

#### 9.2 Sync State Management

The sync state follows a strict hierarchy:

1. **Persisted Settings (Source of Truth)**
   - Stored in chrome.storage.sync
   - Controls whether sync is enabled for each group
   - Updated through explicit user actions
   - Survives browser restarts

2. **Runtime Mappings (Temporary State)**
   - Reflects the persisted settings
   - Contains additional runtime information
   - Always updated to match persisted settings
   - Reset on browser restart

Example of sync state management:

```typescript
// In SyncEngine
async setGroupSyncEnabled(name: string, enabled: boolean): Promise<void> {
  // First update the persisted settings (source of truth)
  await this.storage.updateGroupSyncSettings(name, { 
    enabled,
    lastSynced: Date.now()
  });
  
  // Then update runtime mapping to match
  await this.storage.updateMapping(name, { 
    syncEnabled: enabled,
    userAction: true
  });
}

// Always check persisted settings first
async handleGroupUpdated(group: chrome.tabGroups.TabGroup): Promise<void> {
  const name = group.title || 'Unnamed Group';
  const groupSettings = await this.storage.getGroupSyncSettings(name);
  
  // Always update mapping to match persisted settings
  await this.storage.updateMapping(name, {
    currentGroupId: group.id.toString(),
    color: group.color,
    syncEnabled: groupSettings.enabled
  });
}
```

#### 9.3 State Flow and Synchronization

1. **UI State Updates**

```typescript
// Component state
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState<Error | null>(null);

// Update flow
try {
  setIsLoading(true);
  await sendMessage({ type: 'UPDATE_SETTINGS', settings });
  // Storage event will trigger UI update
} catch (error) {
  setError(error);
} finally {
  setIsLoading(false);
}
```

2. **Background State Updates**

```typescript
// Background service
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_SETTINGS') {
    Promise.resolve().then(async () => {
      try {
        await storage.updateSettings(message.settings);
        // Storage event will notify UI
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    });
    return true; // Keep channel open for async
  }
});
```

3. **State Synchronization**
   - Chrome storage events keep UI in sync
   - Background service maintains source of truth
   - Rate limiting prevents API abuse
   - Error states are propagated to UI

### 10. Communication Patterns

#### 10.1 Message Types

```typescript
// Message type definitions
type Message = 
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Settings }
  | { type: 'TOGGLE_SYNC'; name: string }
  | { type: 'SYNC_GROUP'; name: string }
  | { type: 'SYNC_ALL' };

// Response type definitions
type Response<T = void> = {
  error?: string;
  data?: T;
};
```

#### 10.2 Message Flow

1. **UI to Background**

```typescript
// Sending message
const response = await chrome.runtime.sendMessage({
  type: 'TOGGLE_SYNC',
  name: groupName
});

// Background handling
chrome.runtime.onMessage.addListener((
  message: Message,
  sender,
  sendResponse
) => {
  if (message.type === 'TOGGLE_SYNC') {
    handleToggleSync(message.name)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open
  }
});
```

2. **Background to UI**

```typescript
// Storage events
chrome.storage.onChanged.addListener((changes) => {
  // UI components react to changes
});

// Tab group events
chrome.tabGroups.onUpdated.addListener((group) => {
  // Trigger sync if needed
});
```

### 11. Error Handling & Recovery

#### 11.1 Error Types

```typescript
// Define specific error types
class SyncError extends Error {
  constructor(message: string, public readonly group: string) {
    super(message);
    this.name = 'SyncError';
  }
}

class StorageError extends Error {
  constructor(message: string, public readonly operation: string) {
    super(message);
    this.name = 'StorageError';
  }
}
```

#### 11.2 Recovery Strategies

```typescript
// Retry with exponential backoff
async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: Error;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await delay(Math.pow(2, attempt) * 1000);
    }
  }
  throw lastError;
}
```

### 12. Performance Considerations

#### 12.1 Storage Optimization

- Single atomic writes
- Cache frequently accessed data
- Clean up old data periodically
- Minimal data storage

#### 12.2 Rate Limiting

```typescript
export class RateLimiter {
  private queue: number = 0;
  private lastReset: number = Date.now();

  constructor(
    private maxOperations: number,
    private interval: number
  ) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    if (now - this.lastReset > this.interval) {
      this.queue = 0;
      this.lastReset = now;
    }
  
    if (this.queue >= this.maxOperations) {
      const delay = this.interval - (now - this.lastReset);
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.acquire();
    }
  
    this.queue++;
  }
}
```

### 13. Security & Privacy

#### 13.1 Data Handling

- No sensitive data stored
- Data encrypted in transit
- Proper permission scoping
- Secure storage practices

#### 13.2 Permission Usage

```typescript
// Minimal permissions required
{
  "permissions": [
    "tabs",        // For tab access
    "tabGroups",   // For group management
    "bookmarks",   // For folder sync
    "storage"      // For settings
  ]
}
```

### 14. Development & Testing

#### 14.1 Development Workflow

1. Make changes
2. Build: `npm run build`
3. Load unpacked extension
4. Test changes

#### 14.2 Testing Strategy

- Unit tests for managers
- Integration tests for sync
- UI component tests
- End-to-end testing

### 15. Extension Lifecycle

#### 15.1 Installation

```typescript
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    // Initialize default settings
    await storage.initializeDefaults();
  } else if (reason === 'update') {
    // Run migrations if needed
    await storage.runMigrations();
  }
});
```

#### 15.2 Updates

- Version migration support
- Settings preservation
- Data structure updates
- Backward compatibility

#### 15.3 Uninstallation

```typescript
// Cleanup on uninstall
chrome.runtime.setUninstallURL('https://example.com/feedback');
```

### 16. Storage Optimization Deep Dive

#### 16.1 Storage Strategy

The storage system uses a simple and efficient approach:

```typescript
// Save all state in a single operation
private async saveState(): Promise<void> {
  const data: Record<string, any> = {
    // Core settings and recent history
    'state:settings': this.persistedState.settings,
    'state:history': this.persistedState.syncHistory.slice(-50)
  };

  // Only save preferences that user has explicitly set
  Object.entries(this.persistedState.syncPreferences)
    .forEach(([name, pref]) => {
      if (pref.userSet) {
        data[`pref:${name}`] = {
          syncEnabled: pref.syncEnabled,
          lastSeen: pref.lastSeen,
          lastSynced: pref.lastSynced
        };
      }
    });

  // Single atomic write
  await chrome.storage.sync.set(data);
}
```

#### Key Features

1. **Atomic Operations**
   - Single storage write for all data
   - Prevents partial updates
   - Maintains data consistency

2. **Selective Storage**
   - Only saves user-modified preferences
   - Keeps storage usage minimal
   - Clear data ownership

3. **Data Organization**
   - Namespaced keys (state:*, pref:*)
   - Limited history retention
   - Essential fields only

This approach provides:
- Reliability: Atomic updates prevent inconsistency
- Efficiency: Minimal storage usage
- Simplicity: Easy to understand and maintain

### 17. Help System Implementation

#### HelpDialog Component

The HelpDialog component provides in-app documentation:

```typescript
// src/components/HelpDialog.tsx
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
    >
      <DialogTitle>
        Tab Group Sync Help
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3}>
          {/* Core Concepts */}
          <Section title="Core Concepts">
            <Typography>
              Tab Group Sync automatically backs up your Chrome tab groups to bookmark folders.
              This ensures your groups persist even when Chrome is closed.
            </Typography>
          </Section>

          {/* Container Folder */}
          <Section title="Container Folder">
            <Typography>
              The container folder is where your tab groups are backed up as bookmark folders.
              Each tab group gets its own folder within the container.
            </Typography>
          </Section>

          {/* Sync Settings */}
          <Section title="Sync Settings">
            <Typography>
              Enable sync for each tab group you want to back up. When enabled:
              - Changes to the tab group update the bookmark folder
              - Changes to the bookmark folder update the tab group
              - Sync happens automatically in the background
            </Typography>
          </Section>

          {/* Snapshots */}
          <Section title="Snapshots">
            <Typography>
              Snapshots are point-in-time backups of your tab groups.
              They help you restore previous versions of your groups.
            </Typography>
          </Section>

          {/* Auto-Sync */}
          <Section title="Auto-Sync">
            <Typography>
              New tab groups are automatically set to sync by default.
              This ensures all your groups are backed up unless you explicitly disable sync.
            </Typography>
          </Section>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// Helper component for sections
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
```

#### Key Documentation Points

1. **Core Concepts**

   - Tab group to bookmark folder mapping
   - Automatic background sync
   - Persistence across browser sessions
2. **Features**

   - Container folder selection
   - Per-group sync settings
   - Snapshot management
   - Auto-sync for new groups
3. **User Guidance**

   - Clear explanations
   - Feature descriptions
   - Usage instructions
   - Best practices

This help system ensures users understand:

- How the extension works
- Key features and concepts
- How to use effectively
- Common workflows

### 18. Snapshot System Implementation

#### Overview

The snapshot system provides point-in-time backups of tab groups:

```typescript
// src/lib/bookmarks/snapshotManager.ts
export class SnapshotManager {
  private static readonly SNAPSHOT_PREFIX = 'snapshot_';
  
  constructor(
    private bookmarkManager: BookmarkManager,
    private logger: Logger
  ) {}

  async createSnapshot(
    group: chrome.tabGroups.TabGroup,
    tabs: chrome.tabs.Tab[]
  ): Promise<chrome.bookmarks.BookmarkTreeNode> {
    const timestamp = Date.now();
    const snapshotFolder = await this.bookmarkManager.createFolder(
      `${SnapshotManager.SNAPSHOT_PREFIX}${timestamp}`,
      group.title
    );

    // Save tabs to snapshot
    await Promise.all(
      tabs.map(tab => 
        this.bookmarkManager.createBookmark({
          parentId: snapshotFolder.id,
          title: tab.title || '',
          url: tab.url
        })
      )
    );

    this.logger.info('snapshot:created', {
      group: group.title,
      timestamp,
      tabCount: tabs.length
    });

    return snapshotFolder;
  }

  async restoreSnapshot(
    snapshotId: string,
    windowId: number
  ): Promise<chrome.tabGroups.TabGroup> {
    const snapshot = await chrome.bookmarks.getSubTree(snapshotId);
    const bookmarks = await chrome.bookmarks.getChildren(snapshotId);
  
    // Create new tabs from bookmarks
    const tabs = await Promise.all(
      bookmarks.map(bookmark =>
        chrome.tabs.create({
          windowId,
          url: bookmark.url,
          active: false
        })
      )
    );

    // Group the tabs
    const groupId = await chrome.tabs.group({
      tabIds: tabs.map(tab => tab.id!)
    });

    // Update group properties
    await chrome.tabGroups.update(groupId, {
      title: snapshot[0].title.replace(SnapshotManager.SNAPSHOT_PREFIX, '')
    });

    return chrome.tabGroups.get(groupId);
  }

  async cleanupOldSnapshots(
    maxAge: number = 7 * 24 * 60 * 60 * 1000 // 1 week
  ): Promise<void> {
    const snapshots = await this.getSnapshots();
    const now = Date.now();

    await Promise.all(
      snapshots
        .filter(snapshot => {
          const timestamp = parseInt(
            snapshot.title.replace(SnapshotManager.SNAPSHOT_PREFIX, '')
          );
          return now - timestamp > maxAge;
        })
        .map(snapshot =>
          chrome.bookmarks.removeTree(snapshot.id)
        )
    );
  }
}
```

#### Key Features

1. **Snapshot Creation**

   - Timestamps for versioning
   - Complete tab state preservation
   - Folder-based organization
   - Automatic cleanup
2. **Restoration Process**

   - Tab recreation
   - Group properties restoration
   - Window placement
   - Error handling
3. **Management**

   - Age-based cleanup
   - Storage optimization
   - Logging and tracking
   - Recovery options

This system provides:

- Data persistence
- Version control
- Recovery options
- Storage management
