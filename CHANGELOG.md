# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.0]

### Added
- Bookmark folder cleanup button in Settings — scan and remove prefix-chain
  cruft folders with preview before deletion, union-merging bookmarks into
  the canonical folder
- E2E test for the cleanup feature

### Fixed
- Tab group rename no longer creates intermediate bookmark folders per keystroke
  (debounce at listener level + rename-in-place at sync engine level)
- Duplicate-title bookmark folders are now handled correctly via rename-in-place
  instead of orphan-and-create

## [1.2.0]

### Added
- Move tab groups across windows with human-friendly window labels
  (group names → active tab title/domain → generic fallback)
- Welcome page shown on first install
- Bundled privacy policy page
- Expanded in-app help dialog

### Changed
- Service worker reliability improvements and move-aware sync guards
- Bounded history retention (ring buffer + age pruning)

## [1.1.0]

### Added
- Initial public feature set: automatic tab group backup to bookmarks,
  cross-device sync via Chrome bookmark sync, snapshots, selective sync,
  auto-sync, auto-cleanup, export/import.
