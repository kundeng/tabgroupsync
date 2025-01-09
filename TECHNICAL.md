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
11. [Error Handling & Recovery](#11-error-handling--recovery)
12. [Performance Considerations](#12-performance-considerations)
13. [Security & Privacy](#13-security--privacy)
14. [Development & Testing](#14-development--testing)
15. [Extension Lifecycle](#15-extension-lifecycle)

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
The extension uses a layered storage approach:

```typescript
// Types of state
interface RuntimeState {
  syncInProgress: boolean;
  errors: Record<string, Error>;
  activeGroups: Set<string>;
}

interface PersistedState {
  settings: Settings;
  groupSettings: Record<string, GroupSettings>;
  history: SyncHistory;
}

// Storage operations are chunked for performance
class StorageManager {
  private async saveChunked(key: string, data: any): Promise<void> {
    const chunks = this.splitIntoChunks(data);
    await Promise.all(
      chunks.map((chunk, index) =>
        chrome.storage.sync.set({
          [`${key}_${index}`]: chunk
        })
      )
    );
  }

  private async loadChunked(key: string): Promise<any> {
    const keys = await this.getChunkKeys(key);
    const chunks = await Promise.all(
      keys.map(k => chrome.storage.sync.get(k))
    );
    return this.reassembleChunks(chunks);
  }
}
```

#### 9.2 State Flow
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

#### 9.3 State Synchronization
- Chrome storage events keep UI in sync
- Background service maintains source of truth
- Rate limiting prevents API abuse
- Error states are propagated to UI
