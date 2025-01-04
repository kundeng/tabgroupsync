export const BOOKMARK_FOLDERS = {
  TAB_GROUPS: 'Tab Group Bookmarks',
  SNAPSHOTS: 'Tab Group Snapshots',
  UNGROUPED: 'Ungrouped Tabs'
} as const;

// Folder lookup strategy:
// 1. Try by ID first (fast, but only works in same session)
// 2. If not found, search by path (slower, but works across sessions)
// 3. If still not found, create new folder
export const FOLDER_LOOKUP_STRATEGIES = {
  BY_ID: 'by_id',
  BY_PATH: 'by_path',
  CREATE: 'create'
} as const;
