# Tab Group Sync - Technical Guide for Beginners

This guide explains how to build a Chrome extension using React, starting from basic concepts and building up to advanced features.

## Table of Contents
1. [Getting Started](#1-getting-started)
2. [Chrome Extension Basics](#2-chrome-extension-basics)
3. [React UI Development](#3-react-ui-development)
4. [State and Data Flow](#4-state-and-data-flow)
5. [Advanced Topics](#5-advanced-topics)

## 1. Getting Started
- Project setup
- Required tools
- Development environment
- Basic concepts

## 2. Chrome Extension Basics
- What is a Chrome extension?
- Manifest file explained
- Background services
- Extension permissions

## 3. React UI Development

### 3.1 Component Structure
Our extension uses a hierarchical component structure:
```
App (main popup)
├── Header (title and controls)
│   └── HelpDialog (documentation)
├── Settings (user preferences)
│   └── FolderPicker (bookmark location)
├── GroupList (tab groups)
│   └── GroupSection (group management)
└── SyncStatus (sync progress)
```

### 3.2 Building React Components

Let's look at some key components and how they're built:

#### The Header Component

The Header component demonstrates basic React concepts:
- Using hooks (useState)
- Material-UI components
- Event handling
- Component composition

Here's the implementation:

```typescript
// src/components/Header.tsx
import React from 'react';
import { Typography, Box, IconButton, Tooltip } from '@mui/material';
import ExtensionIcon from '@mui/icons-material/Extension';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import HelpDialog from './HelpDialog';

export default function Header() {
  // State management using React hooks
  const [helpOpen, setHelpOpen] = React.useState(false);

  return (
    <Box sx={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: 1,
      mb: 1.5 
    }}>
      {/* Extension icon */}
      <ExtensionIcon color="primary" />
      
      {/* Title section */}
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" component="h1">
          Tab Group Sync
        </Typography>
        
        {/* Help button with tooltip */}
        <Tooltip title="Help & Information">
          <IconButton
            onClick={() => setHelpOpen(true)}
            size="small"
            color="primary"
          >
            <HelpOutlineIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Help dialog */}
      <HelpDialog 
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </Box>
  );
}
```

Key concepts demonstrated:
1. **Component State**: Using `useState` hook to manage dialog visibility
2. **Event Handling**: Using `onClick` to handle button clicks
3. **Material-UI**: Using MUI components for consistent styling
4. **Component Composition**: Including child components (HelpDialog)
5. **Styling**: Using MUI's `sx` prop for styling

#### The GroupSection Component

This component shows more advanced React patterns:
- Props and TypeScript
- Conditional rendering
- List rendering
- Error handling

```typescript
// src/components/GroupSection.tsx
import React from 'react';
import { Box, Typography, Collapse } from '@mui/material';
import { GroupViewModel } from '../lib/types/storage';
import { StorageManager } from '../lib/storage/storageManager';

interface GroupSectionProps {
  title: string;
  groups: GroupViewModel[];
  storage: StorageManager;
  parentFolder: chrome.bookmarks.BookmarkTreeNode | null;
  onToggleSync: (name: string) => Promise<void>;
  onFullResync: (group: GroupViewModel) => Promise<void>;
  readOnly?: boolean;
}

export default function GroupSection({
  title,
  groups,
  storage,
  parentFolder,
  onToggleSync,
  onFullResync,
  readOnly = false
}: GroupSectionProps) {
  // Error state management
  const [error, setError] = React.useState<string | null>(null);

  // Handle sync toggle with error handling
  const handleToggleSync = async (name: string) => {
    try {
      setError(null);
      await onToggleSync(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle sync');
    }
  };

  return (
    <Box sx={{ mb: 2 }}>
      {/* Section title */}
      <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
        {title}
      </Typography>

      {/* Error message */}
      <Collapse in={!!error}>
        <Typography color="error" variant="body2" sx={{ mb: 1 }}>
          {error}
        </Typography>
      </Collapse>

      {/* Group list */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {groups.map(group => (
          <GroupItem
            key={group.id}
            group={group}
            onToggleSync={handleToggleSync}
            onFullResync={onFullResync}
            readOnly={readOnly}
          />
        ))}
      </Box>
    </Box>
  );
}
```

Key concepts demonstrated:
1. **TypeScript Integration**: Using interfaces for props and types
2. **Props**: Passing and handling multiple props
3. **Error Handling**: Managing and displaying errors
4. **List Rendering**: Using map to render lists of items
5. **Conditional Rendering**: Using Collapse for error messages

### 3.3 React Hooks in Practice

Let's look at how we use React hooks effectively:

#### useState Example
The most basic hook for managing component state:

```typescript
// Managing dialog state
const [helpOpen, setHelpOpen] = React.useState(false);

// Managing error state with type
const [error, setError] = React.useState<string | null>(null);
```

#### useEffect Example
For handling side effects like loading data:

```typescript
// From GroupList.tsx
React.useEffect(() => {
  // Load groups when component mounts
  const loadGroups = async () => {
    try {
      const allGroups = await chrome.tabGroups.query({});
      setGroups(allGroups);
    } catch (error) {
      setError('Failed to load groups');
    }
  };

  // Set up event listeners
  const handleChange = () => loadGroups();
  chrome.tabGroups.onCreated.addListener(handleChange);
  chrome.tabGroups.onUpdated.addListener(handleChange);

  // Initial load
  loadGroups();

  // Cleanup on unmount
  return () => {
    chrome.tabGroups.onCreated.removeListener(handleChange);
    chrome.tabGroups.onUpdated.removeListener(handleChange);
  };
}, []); // Empty dependency array means run once on mount
```

### 3.4 Material-UI Integration

Our extension uses Material-UI (MUI) for consistent styling:

#### Theme Configuration
```typescript
// From App.tsx
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1a73e8', // Google Blue
    }
  },
  typography: {
    fontSize: 14,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none', // Prevent all-caps text
        },
      },
    },
  },
});

// Usage in App
return (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    {/* App content */}
  </ThemeProvider>
);
```

#### Common MUI Patterns
1. Layout with Box:
```typescript
<Box sx={{ 
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  p: 2 // padding: theme.spacing(2)
}}>
```

2. Typography for text:
```typescript
<Typography 
  variant="subtitle1"
  color="text.secondary"
  sx={{ mb: 1 }}
>
  Section Title
</Typography>
```

3. Interactive elements:
```typescript
<Tooltip title="Help">
  <IconButton onClick={handleClick} size="small">
    <HelpIcon />
  </IconButton>
</Tooltip>
```

### 3.5 Best Practices

1. **Component Organization**
   - One component per file
   - Clear naming conventions
   - Logical folder structure

2. **TypeScript Usage**
   - Define interfaces for props
   - Use type annotations
   - Avoid 'any' type

3. **Error Handling**
   - Try-catch blocks for async operations
   - Error state management
   - User-friendly error messages

4. **Performance**
   - Memoization when needed
   - Proper dependency arrays in hooks
   - Cleanup in useEffect

## 4. State and Data Flow

### 4.1 Understanding Chrome Extension State

In a Chrome extension, state management is unique because:
1. The popup is temporary (destroyed when closed)
2. The background service is long-running
3. Chrome storage persists data
4. Multiple components need to stay in sync

Here's how we handle it:

```typescript
// In popup components, we use React state for UI
const [isLoading, setIsLoading] = React.useState(false);
const [error, setError] = React.useState<string | null>(null);

// But data comes from Chrome storage via messages
const loadSettings = async () => {
  try {
    setIsLoading(true);
    const response = await chrome.runtime.sendMessage({ 
      type: 'GET_SETTINGS' 
    });
    if (response.error) {
      throw new Error(response.error);
    }
    return response.settings;
  } catch (error) {
    setError('Failed to load settings');
    throw error;
  } finally {
    setIsLoading(false);
  }
};

// And we listen for changes
React.useEffect(() => {
  const handleStorageChange = (changes: {[key: string]: chrome.storage.StorageChange}) => {
    if (changes.settings) {
      // Update local state when storage changes
      setSettings(changes.settings.newValue);
    }
  };
  
  chrome.storage.onChanged.addListener(handleStorageChange);
  return () => chrome.storage.onChanged.removeListener(handleStorageChange);
}, []);
```

### 4.2 Message-Based Communication

Components never access Chrome APIs directly. Instead, they send messages:

```typescript
// Example: Toggling sync for a group
const toggleSync = async (groupName: string) => {
  try {
    // Send message to background
    const response = await chrome.runtime.sendMessage({
      type: 'TOGGLE_SYNC',
      name: groupName
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    // Success! Storage change will trigger UI update
  } catch (error) {
    // Handle error in UI
    setError('Failed to toggle sync');
  }
};
```

This pattern provides several benefits:
1. Clean separation of concerns
2. Type-safe message passing
3. Centralized error handling
4. Automatic UI updates via storage events

## 5. Advanced Topics

### 5.1 Chrome Extension Specific Concepts

#### Manifest V3
Our extension uses Chrome's latest manifest format:
```json
{
  "manifest_version": 3,
  "name": "Tab Group Sync",
  "version": "1.1.0",
  "description": "Synchronize tab groups with bookmark folders",
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

Key points for React developers:
- The popup is a separate HTML page
- Background service runs independently
- Must request permissions explicitly
- Service worker has different lifecycle

### 5.2 Learning Path

1. **Start with React Basics**
   - Components and JSX
   - Hooks (useState, useEffect)
   - Props and state
   - Event handling

2. **Add TypeScript**
   - Type definitions
   - Interfaces
   - Generics
   - Type safety

3. **Learn Material-UI**
   - Component library
   - Theming
   - Styling with sx prop
   - Layout components

4. **Chrome Extension Concepts**
   - Manifest structure
   - Background services
   - Message passing
   - Chrome APIs

5. **Advanced Patterns**
   - State management
   - Error handling
   - Performance optimization
   - Testing

### Next Steps

1. **Experiment with Components**
   - Modify the Header component
   - Add new features to GroupSection
   - Create custom hooks
   - Try different MUI components

2. **Explore Chrome APIs**
   - Read Chrome's documentation
   - Test different permissions
   - Try other extension features
   - Build your own extensions

3. **Contribute**
   - Read the codebase
   - Fix small bugs
   - Add documentation
   - Propose improvements
