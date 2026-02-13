# Tab Group Sync

A Chrome extension that automatically synchronizes tab groups with bookmark folders, enabling users to save and restore tab group layouts across devices and browser sessions.

## Features

*(sourced from [requirements.md](.kiro/specs/tab-group-sync/requirements.md))*

- **Tab Group Backup** (Req 1): Automatically backs up Chrome tab groups to bookmark folders
- **Cross-Device Sync** (Req 2): Syncs tab groups across devices using Chrome's bookmark sync
- **Selective Sync** (Req 3): Per-group sync control — enable/disable sync for individual groups
- **Container Folder** (Req 4): Organized storage in a user-selected bookmark folder
- **Snapshots** (Req 5): Point-in-time backups with create, restore, and cleanup
- **Auto-Sync** (Req 6): New tab groups automatically enabled for sync
- **Group Name Handling** (Req 13): Graceful handling of unnamed and whitespace-only groups

## Development

### Prerequisites

- Node.js v16+
- npm v7+
- Chrome browser

### Setup

```bash
npm install
npm run build
```

Load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `dist/`

### Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build for production |
| `npm run watch` | Build and watch for changes |
| `npm test` | Run unit + property tests (Vitest) |
| `npm run test:e2e` | Build + run E2E tests (Playwright) |
| `npm run test:e2e:headed` | E2E tests with visible browser |
| `npm run test:coverage` | Unit tests with coverage report |

## Testing

- **Unit tests**: Vitest with mocked Chrome APIs
- **Property tests**: fast-check for correctness properties (30 properties, 100+ iterations each)
- **E2E tests**: Playwright with real Chrome extension loading

See [Property Coverage](tests/property/PROPERTY_COVERAGE.md) and [E2E README](tests/e2e/README.md).

## Documentation

| Document | Purpose |
|----------|---------|
| [Spec: requirements.md](.kiro/specs/tab-group-sync/requirements.md) | **System of record** — all requirements |
| [Spec: design.md](.kiro/specs/tab-group-sync/design.md) | Architecture, properties, pseudocode |
| [Spec: tasks.md](.kiro/specs/tab-group-sync/tasks.md) | Implementation tasks and status |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | Learning guide and technical reference |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Known limitations and edge cases |

## License

MIT License
