# Technology Stack

## Core Technologies

- **TypeScript**: Primary language for type safety and developer experience
- **React 18**: UI framework with hooks and functional components
- **Material-UI (MUI) v6**: Component library and design system
- **Vite**: Build tool and development server
- **Chrome Extension Manifest V3**: Latest extension platform

## Key Libraries

- **@mui/material**: Core Material-UI components
- **@mui/icons-material**: Material Design icons
- **@emotion/react & @emotion/styled**: CSS-in-JS styling
- **@types/chrome**: TypeScript definitions for Chrome APIs

## Build System

### Development Commands

```bash
# Install dependencies
npm install

# Build extension for production
npm run build

# Build and watch for changes (development)
npm run watch

# Type checking
npx tsc --noEmit
```

### Build Process

1. TypeScript compilation (`tsc`)
2. Vite bundling with React plugin
3. Extension file copying (`scripts/copy-extension-files.js`)

### Build Configuration

- **Target**: Chrome 112+ (modern Chrome features)
- **Output**: `dist/` directory
- **Entry Points**: 
  - `src/popup.tsx` → `popup.js`
  - `src/background.ts` → `background.js`
- **Sourcemaps**: Enabled for debugging
- **Minification**: Disabled for development

## Chrome Extension Architecture

### Manifest V3 Structure

- **Service Worker**: `background.js` (replaces background pages)
- **Popup**: `popup.html` with React app
- **Permissions**: `tabs`, `tabGroups`, `bookmarks`, `storage`, `unlimitedStorage`
- **Content Security Policy**: Strict CSP for security

### Key Chrome APIs Used

- `chrome.tabGroups.*`: Tab group management
- `chrome.tabs.*`: Tab operations
- `chrome.bookmarks.*`: Bookmark folder sync
- `chrome.storage.sync.*`: Settings and state persistence
- `chrome.runtime.*`: Message passing and lifecycle

## Development Environment

### Prerequisites

- Node.js v16+
- npm v7+
- Chrome browser with Developer Mode enabled

### Extension Loading

1. Build: `npm run build`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `dist/` directory

### Hot Reload

Use `npm run watch` for automatic rebuilds. Manual extension reload required in Chrome.

## Testing Strategy

- **Unit Tests**: Vitest with mocked Chrome APIs for manager classes and utilities
- **Property Tests**: fast-check for correctness properties across randomized inputs
- **E2E Tests**: Playwright loading the real extension in isolated Chrome profiles

See spec NF 1 for detailed testing requirements.