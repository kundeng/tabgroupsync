/**
 * Fast-check arbitraries for property-based testing
 * 
 * This file contains reusable arbitrary generators for Chrome extension entities
 * used across all property-based tests.
 */

import * as fc from 'fast-check';

/**
 * Arbitrary for generating valid Chrome tab group colors
 */
export const arbitraryColor = fc.constantFrom(
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange'
) as fc.Arbitrary<chrome.tabGroups.ColorEnum>;

/**
 * Arbitrary for generating valid URLs
 */
export const arbitraryUrl = fc.webUrl({ validSchemes: ['http', 'https'] });

/**
 * Arbitrary for generating Chrome tab objects
 * 
 * @param options - Optional configuration for tab generation
 * @param options.groupId - Override groupId generation (useful for testing ungrouped tabs)
 */
export const arbitraryTab = (options?: { groupId?: fc.Arbitrary<number> }) =>
  fc.record({
    id: fc.integer({ min: 1, max: 10000 }),
    url: arbitraryUrl,
    title: fc.string({ minLength: 1, maxLength: 100 }),
    pinned: fc.boolean(),
    groupId: options?.groupId ?? fc.integer({ min: 1, max: 1000 }),
    windowId: fc.integer({ min: 1, max: 10 }),
    index: fc.integer({ min: 0, max: 100 }),
    active: fc.boolean(),
    highlighted: fc.boolean(),
    incognito: fc.boolean(),
  });

/**
 * Arbitrary for generating ungrouped tabs (groupId === -1)
 */
export const arbitraryUngroupedTab = () =>
  arbitraryTab({ groupId: fc.constant(-1) });

/**
 * Arbitrary for generating Chrome tab group objects
 * Generates titles with at least one non-whitespace character
 */
export const arbitraryTabGroup = fc.record({
  id: fc.integer({ min: 1, max: 1000 }),
  title: fc.stringMatching(/^.*[^\s].*$/).filter(s => s.length > 0 && s.length <= 50),
  color: arbitraryColor,
  windowId: fc.integer({ min: 1, max: 10 }),
  collapsed: fc.boolean(),
});

/**
 * Arbitrary for generating Chrome bookmark objects
 * 
 * @param options - Optional configuration for bookmark generation
 * @param options.isFolder - If true, generates folder bookmarks (no URL)
 */
export const arbitraryBookmark = (options?: { isFolder?: boolean }) =>
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 20 }),
    title: fc.string({ minLength: 1, maxLength: 100 }),
    url: options?.isFolder ? fc.constant(undefined) : fc.option(arbitraryUrl, { nil: undefined }),
    parentId: fc.string({ minLength: 1, maxLength: 20 }),
    index: fc.integer({ min: 0, max: 100 }),
    dateAdded: fc.integer({ min: 1000000000000, max: Date.now() }),
  });

/**
 * Arbitrary for generating bookmark folder objects
 */
export const arbitraryBookmarkFolder = () =>
  arbitraryBookmark({ isFolder: true });

/**
 * Arbitrary for generating sync settings
 */
export const arbitrarySyncSettings = fc.record({
  syncEnabled: fc.boolean(),
  userSet: fc.boolean(),
  lastSeen: fc.integer({ min: 1000000000000, max: Date.now() }),
  lastSynced: fc.integer({ min: 1000000000000, max: Date.now() }),
});

/**
 * Arbitrary for generating global settings
 */
export const arbitraryGlobalSettings = fc.record({
  containerFolderId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  autoSync: fc.boolean(),
  keepRemoved: fc.boolean(),
  cleanup: fc.record({
    enabled: fc.boolean(),
    inactiveThreshold: fc.integer({ min: 1, max: 365 }),
    autoArchive: fc.boolean(),
    deleteThreshold: fc.integer({ min: 1, max: 365 }),
  }),
});

/**
 * Arbitrary for generating runtime mappings
 */
export const arbitraryRuntimeMapping = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  currentGroupId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  folderId: fc.string({ minLength: 1, maxLength: 20 }),
  color: fc.option(arbitraryColor, { nil: undefined }),
  syncEnabled: fc.boolean(),
  status: fc.record({
    lastSynced: fc.integer({ min: 1000000000000, max: Date.now() }),
    inProgress: fc.boolean(),
    error: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  }),
});

/**
 * Arbitrary for generating snapshot data
 */
export const arbitrarySnapshot = fc.record({
  timestamp: fc.integer({ min: 1000000000000, max: Date.now() }),
  groupName: fc.string({ minLength: 1, maxLength: 50 }),
  tabs: fc.array(arbitraryTab(), { minLength: 1, maxLength: 20 }),
  color: arbitraryColor,
});

/**
 * Arbitrary for generating operation types
 */
export const arbitraryOperationType = fc.constantFrom(
  'sync',
  'create',
  'update',
  'delete',
  'restore'
);

/**
 * Arbitrary for generating operation outcomes
 */
export const arbitraryOperationOutcome = fc.constantFrom(
  'success',
  'failure',
  'partial'
);

/**
 * Arbitrary for generating target types
 */
export const arbitraryTargetType = fc.constantFrom(
  'group',
  'folder',
  'bookmark',
  'snapshot'
);
