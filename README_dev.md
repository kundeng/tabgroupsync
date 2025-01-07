Tab Group Sync is a Chrome extension that automatically synchronizes Chrome tab groups with bookmark folders. Here's a detailed breakdown:

Project Setup:
Built with React 18, TypeScript, and Vite
Uses Material UI for components and Tailwind CSS for styling
Chrome extension manifest V3 with required permissions for tabs, groups, bookmarks, and storage
HTML/CSS Structure:
popup.html serves as the extension's UI entry point
Material UI theming with custom overrides for consistent styling
Responsive layout with scrollable content and custom scrollbar styling
Main Entry Points:
main.tsx: React application bootstrap
background.ts: Service worker for background operations
popup.tsx: Extension popup UI initialization
React Components:
App.tsx: Main component handling initialization and layout
Settings.tsx: Configuration interface
GroupList.tsx: Displays tab groups
SyncStatus.tsx: Shows synchronization status
Other supporting components for specific features
Libraries and Utilities:
validators.ts: Type validation
logger.ts: Logging system
errors.ts: Error handling
promiseUtils.ts: Promise utilities
tabUtils.ts: Chrome tabs helper functions
Sync and Storage:
SyncEngine: Core synchronization logic between tab groups and bookmarks
StorageManager: Handles data persistence using Chrome's storage API
Supports both persisted state and runtime state
Implements cleanup and archiving features
Bookmark Management:
BookmarkManager: Handles bookmark operations
Maintains folder hierarchy for tab groups
Handles bookmark creation, updates, and removal
Supports ungrouped tabs management
Event Listeners:
bookmarkListeners.ts: Bookmark event handling
tabGroupListeners.ts: Tab group event handling
tabListeners.ts: Tab event handling
Types and Constants:
Comprehensive TypeScript interfaces for all data structures
Supports tab groups, bookmarks, settings, and sync states
Runtime mappings between tab groups and bookmark folders
History tracking for sync operations
Key Features:

Automatic synchronization of tab groups to bookmark folders
Configurable sync settings per group
Support for ungrouped tabs
Cleanup of inactive groups
Sync history tracking
Error handling and recovery
Cross-device synchronization through Chrome's bookmark sync
The extension maintains a robust state management system with both persisted storage (for cross-session data) and runtime state (for current session data), ensuring reliable synchronization between Chrome tab groups and bookmark folders.


