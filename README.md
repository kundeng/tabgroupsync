# Tab Group Sync

A Chrome extension that syncs tab groups with bookmarks, allowing you to save and restore your tab group layouts across devices.

## Features

- **Tab Group Backup**: Automatically backs up Chrome tab groups to bookmark folders
- **Cross-Device Sync**: Syncs tab groups across devices using Chrome's bookmark sync
- **Selective Sync**: Per-group sync control - enable/disable sync for individual groups
- **Container Folder**: Organized storage in a user-selected bookmark folder
- **Snapshots**: Point-in-time backups for tab group restoration
- **Auto-Sync**: New tab groups automatically enabled for sync by default
- **Material UI**: Clean, modern interface using Material-UI components

## Development

### Prerequisites

- Node.js (v16 or higher)
- npm (v7 or higher)
- Chrome browser

### Setup

1. Install dependencies:
```bash
npm install
```

2. Build the extension:
```bash
npm run build
```

3. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` directory from the project

### Development Commands

- `npm run build` - Build for production
- `npm run watch` - Build and watch for changes (development)
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

## Documentation

- See [Technical Documentation](docs/TECHNICAL.md) for detailed architecture and implementation details
- Check `.kiro/steering/` for development guidelines and project structure

## License

MIT License
