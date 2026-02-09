# Project Structure

## Root Directory

```
├── src/                    # Source code
├── dist/                   # Build output (generated)
├── public/                 # Static assets
├── scripts/                # Build scripts
├── .kiro/                  # Kiro configuration
├── manifest.json           # Extension manifest
├── package.json            # Dependencies and scripts
├── vite.config.ts          # Build configuration
└── tsconfig.json           # TypeScript configuration
```

## Source Code Organization (`src/`)

### Core Structure

```
src/
├── components/             # React UI components
├── lib/                   # Core business logic
├── listeners/             # Chrome API event handlers
├── types/                 # TypeScript type definitions
├── background.ts          # Service worker entry point
├── popup.tsx             # Popup UI entry point
└── main.tsx              # React app initialization
```

### Component Architecture (`src/components/`)

```
components/
├── App.tsx               # Root application component
├── ErrorBoundary.tsx     # Error handling wrapper
├── Header.tsx            # Extension header with title/help
├── Settings.tsx          # Settings panel and folder picker
├── GroupList.tsx         # Tab group list and management
├── GroupSection.tsx      # Individual group display
├── SnapshotList.tsx      # Snapshot management UI
├── SyncStatus.tsx        # Sync status indicator
├── FolderPicker.tsx      # Bookmark folder selection
├── LocationDisplay.tsx   # Current folder display
└── HelpDialog.tsx        # In-app help system
```

### Business Logic (`src/lib/`)

```
lib/
├── bookmarks/            # Bookmark operations
│   ├── bookmarkManager.ts    # Bookmark CRUD operations
│   ├── bookmarkMutations.ts  # Bookmark modification helpers
│   ├── bookmarkQueries.ts    # Bookmark query helpers
│   └── snapshotManager.ts    # Snapshot system
├── storage/              # State management
│   └── storageManager.ts     # Settings and data persistence
├── sync/                 # Synchronization engine
│   └── syncEngine.ts         # Tab group ↔ bookmark sync
├── types/                # Type definitions
│   └── storage.ts            # Storage-related types
├── utils/                # Utility functions
│   ├── errors.ts             # Error handling utilities
│   ├── logger.ts             # Logging system
│   ├── promiseUtils.ts       # Promise helpers
│   ├── rateLimiter.ts        # API rate limiting
│   ├── tabUtils.ts           # Tab manipulation helpers
│   └── validators.ts         # Data validation
├── constants.ts          # Application constants
└── tabGroupManager.ts    # Tab group operations
```

### Event Handlers (`src/listeners/`)

```
listeners/
├── bookmarkListeners.ts  # Bookmark change events
├── tabGroupListeners.ts  # Tab group events
└── tabListeners.ts       # Tab events
```

## Architecture Patterns

### Manager Pattern

Each major functionality area has a dedicated manager class:

- **StorageManager**: Settings and state persistence
- **BookmarkManager**: Bookmark folder operations
- **SyncEngine**: Coordination between tab groups and bookmarks
- **TabGroupManager**: Tab group lifecycle management
- **SnapshotManager**: Point-in-time backups

### Message-Based Communication

- UI components send messages to background service
- Background service handles Chrome API operations
- Storage events propagate state changes to UI
- Type-safe message definitions in TypeScript

### Component Hierarchy

```
App (root)
├── Header
├── Settings
│   ├── FolderPicker
│   └── LocationDisplay
├── GroupList
│   └── GroupSection (per group)
│       └── SnapshotList
└── SyncStatus
```

## File Naming Conventions

- **Components**: PascalCase (e.g., `GroupList.tsx`)
- **Managers**: camelCase with Manager suffix (e.g., `bookmarkManager.ts`)
- **Utilities**: camelCase (e.g., `rateLimiter.ts`)
- **Types**: camelCase (e.g., `storage.ts`)
- **Constants**: camelCase (e.g., `constants.ts`)

## Import Organization

1. External libraries (React, MUI)
2. Chrome API types
3. Internal managers and utilities
4. Local components
5. Type definitions

## Configuration Files

- **manifest.json**: Extension permissions and metadata
- **vite.config.ts**: Build configuration with React plugin
- **tsconfig.json**: TypeScript compiler options
- **package.json**: Dependencies and build scripts