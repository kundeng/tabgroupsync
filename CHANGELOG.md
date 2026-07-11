# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.0]

### Added
- **Local file URL sync**: `file://` URLs in tab groups are now captured to
  bookmarks (previously silently dropped by all Chromium browsers)
- **Cross-machine path mapping**: Bidirectional prefix rewriting so file://
  bookmarks open correctly across macOS, Linux, and Windows
  (e.g., `/Users/foo/Dropbox` ↔ `/home/foo/Dropbox`)
- **Per-group file restore**: Button on each group to open file:// tabs from
  bookmarks with path mapping applied
- **Bulk file restore**: "Open all file:// tabs" button in Settings to recover
  all file:// URLs across all groups at once
- **Opener page**: Fallback page when file:// access is not enabled, with
  setup instructions and manual path input
- **Edge Workspace warning**: Alerts users that closing "workspace unsupported"
  tabs kills the real tab on the source machine
- **File URL access detection**: Banner in Settings when "Allow access to file
  URLs" is not enabled
- Bookmark folder cleanup button in Settings — scan and remove prefix-chain
  cruft folders with preview before deletion
- E2E test for the cleanup feature

### Fixed
- Tab group rename no longer creates intermediate bookmark folders per keystroke
- Duplicate-title bookmark folders handled correctly via rename-in-place

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
