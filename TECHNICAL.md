# Tab Group Sync - Technical Documentation

This document provides a comprehensive technical overview of the Tab Group Sync Chrome extension, explaining its architecture, components, and implementation details.

## Table of Contents
- [1. Architecture Overview](#1-architecture-overview)
- [2. Core Components](#2-core-components)
- [3. UI Components](#3-ui-components)
- [4. State Management](#4-state-management)
- [5. Communication Patterns](#5-communication-patterns)
- [6. Error Handling & Recovery](#6-error-handling--recovery)
- [7. Performance Considerations](#7-performance-considerations)
- [8. Security & Privacy](#8-security--privacy)
- [9. Development & Testing](#9-development--testing)
- [10. Extension Lifecycle](#10-extension-lifecycle)

## 1. Architecture Overview

The extension follows a message-based architecture that separates UI components from core functionality:

### Chrome Extension Architecture
- **Popup**: React-based UI that users interact with
- **Background Service**: Service worker that handles core functionality
- **Message-Based Communication**: Ensures clean separation of concerns

### Manager-Based Design Pattern
The extension uses specialized managers for different responsibilities:
- **StorageManager**: Handles state persistence and runtime state
- **BookmarkManager**: Manages bookmark folder operations
- **TabGroupManager**: Interfaces with Chrome's tab group API
- **SyncEngine**: Coordinates synchronization between tabs and bookmarks

### Reactive State Management
State updates flow naturally through the system:
1. Chrome events trigger background service
2. Background updates storage
3. Storage events update UI
4. UI actions message background
5. Background processes actions and updates state

### Storage Strategy
- **Runtime State**: Kept in memory for performance
- **Persisted State**: Stored in Chrome's sync storage
- **Event-Based Updates**: Components react to storage changes

## 2. Core Components

### 2.1 Background Service
The background service worker (background.ts) is the heart of the extension:
- Initializes and manages core services
- Handles message routing
- Implements error recovery and retries
- Manages extension lifecycle

### 2.2 Storage System
The storage system (StorageManager) implements:
- Clear separation of runtime vs persisted state
- Optimized storage operations
- Chrome storage sync integration
- Data migration support

### 2.3 Sync Engine
The sync engine (SyncEngine) handles bidirectional synchronization:
- Tab Group → Bookmark folder sync
- Bookmark folder → Tab Group sync
- Conflict resolution
- Rate limiting for API calls

### 2.4 Tab Group Management
TabGroupManager interfaces with Chrome's API:
- Creates and updates tab groups
- Tracks group state changes
- Handles tab operations
- Manages group metadata

### 2.5 Bookmark Management
BookmarkManager handles all bookmark operations:
- Creates and updates folders
- Maintains folder hierarchy
- Handles snapshots
- Implements cleanup

## 3. UI Components

### 3.1 Component Hierarchy
React-based UI with clear component hierarchy:
```
App
├── Header
│   └── HelpDialog
├── Settings
│   └── FolderPicker
├── GroupList
│   └── GroupSection
│       ├── SyncStatus
│       └── SnapshotList
└── ErrorBoundary
```

### 3.2 Key Components
Each component has specific responsibilities:

#### GroupList
- Manages list of tab groups
- Handles group categorization
- Reacts to Chrome events
- Updates group status

#### Settings
- Container folder selection
- Auto-sync preferences
- Cleanup settings
- Sync frequency

#### SyncStatus
- Shows sync progress
- Displays errors
- Provides sync controls
- Shows history

#### HelpDialog
- Documents key concepts
- Provides usage tips
- Shows feature explanations
- Offers best practices

## 4. State Management

### 4.1 Runtime State
Ephemeral state that doesn't need persistence:
- Current tab group status
- UI state (expanded/collapsed sections)
- Sync operation progress
- Error states

### 4.2 Persisted State
State that survives browser restarts:
- User preferences
- Sync settings per group
- Group mappings
- Last seen timestamps

### 4.3 State Flow
The extension uses a reactive state flow:
1. Chrome Events → Background Service
2. Background Service → Storage
3. Storage Events → UI Components
4. UI Actions → Background Service

### 4.4 State Synchronization
- Chrome storage sync for cross-device state
- Runtime state for performance
- Event-based updates for reactivity
- Optimized storage operations

## 5. Communication Patterns

### 5.1 UI to Background
Messages from UI components to background service:
- GET_SETTINGS: Retrieve user settings
- UPDATE_SETTINGS: Modify settings
- TOGGLE_SYNC: Enable/disable group sync
- FULL_RESYNC: Force group resync
- GET_HISTORY: Retrieve sync history

### 5.2 Background to UI
Updates from background to UI components:
- Chrome storage events
- Tab group events
- Bookmark events
- Error notifications

### 5.3 Message Flow
Example of a typical message flow:
1. User toggles sync for a group
2. UI sends TOGGLE_SYNC message
3. Background processes request
4. Storage is updated
5. UI reacts to storage change
6. Status is updated

### 5.4 Error Handling
- Error responses include details
- UI shows appropriate error messages
- Background retries when appropriate
- Errors are logged for debugging

## 6. Error Handling & Recovery

### 6.1 Error Types
- Network errors
- Chrome API errors
- Storage errors
- Validation errors
- Sync conflicts

### 6.2 Recovery Strategies
- Automatic retries with backoff
- State rollback on failure
- Conflict resolution
- User notification
- Error logging

### 6.3 Error Boundaries
- React error boundaries catch UI errors
- Background service handles core errors
- Storage system handles persistence errors
- Network error recovery

### 6.4 User Feedback
- Error messages in UI
- Status indicators
- Progress feedback
- Recovery options

## 7. Performance Considerations

### 7.1 Storage Optimization
- Minimal persisted state
- Batched storage operations
- Runtime state for performance
- Cleanup of old data

### 7.2 Rate Limiting
- API call throttling
- Sync operation spacing
- Batch processing
- Queue management

### 7.3 Event Handling
- Event debouncing
- Efficient state updates
- Optimized re-renders
- Resource cleanup

## 8. Security & Privacy

### 8.1 Permission Model
Required permissions:
- tabs: For tab group access
- tabGroups: For group management
- bookmarks: For folder operations
- storage: For state persistence
- unlimitedStorage: For large sync operations

### 8.2 Data Storage
- User preferences in sync storage
- No sensitive data stored
- Data cleanup on uninstall
- Secure storage practices

### 8.3 API Usage
- Chrome APIs used securely
- Rate limiting implemented
- Error handling for security
- Safe data handling

## 9. Development & Testing

### 9.1 Project Structure
```
src/
├── components/    # React components
├── lib/          # Core functionality
│   ├── bookmarks/  # Bookmark operations
│   ├── storage/    # State management
│   ├── sync/       # Sync engine
│   ├── types/      # TypeScript types
│   └── utils/      # Utilities
├── listeners/    # Event listeners
└── background.ts # Service worker
```

### 9.2 Build System
- TypeScript compilation
- Vite bundling
- Extension packaging
- Resource copying

### 9.3 Development Workflow
- Local development
- Chrome extension loading
- Hot reload support
- Debug logging

## 10. Extension Lifecycle

### 10.1 Installation
When the extension is installed:
1. Default settings created
2. Storage initialized
3. Background service started
4. Event listeners registered

### 10.2 Updates
During extension updates:
1. Version check performed
2. State migration if needed
3. New features initialized
4. Settings preserved

### 10.3 State Migration
Version-based state migration:
- v1 to v2: Storage chunking
- Settings preservation
- Data structure updates
- Backward compatibility

### 10.4 Cleanup
On extension removal:
1. Storage cleared
2. Event listeners removed
3. Service worker terminated
4. Resources released

## Next Steps

This technical documentation provides an overview of the Tab Group Sync extension's architecture and implementation. For detailed code examples and specific implementations, refer to the individual source files referenced throughout this document.

To contribute or extend the extension:
1. Review the architecture overview
2. Understand the messaging patterns
3. Follow the established patterns
4. Maintain type safety
5. Add appropriate error handling
6. Include documentation
