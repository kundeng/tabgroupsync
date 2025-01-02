# Tab Group Sync

A Chrome extension that syncs tab groups with bookmarks, allowing you to save and restore your tab group layouts across devices.

## Features

- Sync tab groups with bookmarks
- Auto-sync option for automatic updates
- Custom parent folder selection for organized storage
- Visual folder picker with tree navigation
- Material UI design

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

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

## License

MIT License
