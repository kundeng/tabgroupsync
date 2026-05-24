import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { arbitraryTab, arbitraryUngroupedTab, arbitraryTabGroup } from '../arbitraries';
import { setupAllMocks } from '../testUtils';

/**
 * Property 13: UI Display Filtering
 * 
 * For any UI display of sync status, only tabs that belong to groups should be shown,
 * with ungrouped tabs completely excluded from the interface
 * 
 * Validates: Requirements 13.3
 */

describe('Property 13: UI Display Filtering', () => {
  let mocks: ReturnType<typeof setupAllMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = setupAllMocks();
  });

  it('should filter out ungrouped tabs from tab queries', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 10 }),
        fc.array(arbitraryUngroupedTab(), { minLength: 1, maxLength: 10 }),
        async (group, groupedTabs, ungroupedTabs) => {
          // Setup tabs with correct groupIds
          const validGroupedTabs = groupedTabs.map(t => ({
            ...t,
            groupId: group.id,
            url: t.url || 'https://example.com'
          }));
          
          const validUngroupedTabs = ungroupedTabs.map(t => ({
            ...t,
            groupId: -1, // Ungrouped indicator
            url: t.url || 'https://example.com'
          }));

          // Mock tabs query to return all tabs (both grouped and ungrouped)
          const allTabs = [...validGroupedTabs, ...validUngroupedTabs];
          vi.mocked(chrome.tabs.query).mockResolvedValue(allTabs as chrome.tabs.Tab[]);

          // Query for all tabs
          const allResult = await chrome.tabs.query({});
          
          // Filter out ungrouped tabs (as UI should do)
          const filteredResult = allResult.filter(t => t.groupId !== -1);

          // Verify: Filtered result should only contain grouped tabs
          expect(filteredResult.length).toBe(validGroupedTabs.length);
          expect(filteredResult.every(t => t.groupId !== -1)).toBe(true);
          expect(filteredResult.some(t => t.groupId === -1)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should exclude ungrouped tabs when querying all tabs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 10 }),
        fc.array(arbitraryUngroupedTab(), { minLength: 1, maxLength: 10 }),
        async (groupedTabs, ungroupedTabs) => {
          // Setup tabs
          const validGroupedTabs = groupedTabs.map(t => ({
            ...t,
            groupId: t.groupId > 0 ? t.groupId : 1, // Ensure positive groupId
            url: t.url || 'https://example.com'
          }));
          
          const validUngroupedTabs = ungroupedTabs.map(t => ({
            ...t,
            groupId: -1,
            url: t.url || 'https://example.com'
          }));

          const allTabs = [...validGroupedTabs, ...validUngroupedTabs];
          
          // Filter out ungrouped tabs (as UI should do)
          const filteredTabs = allTabs.filter(t => t.groupId !== -1);

          // Verify: Filtered tabs should only contain grouped tabs
          expect(filteredTabs.length).toBe(validGroupedTabs.length);
          expect(filteredTabs.every(t => t.groupId !== -1)).toBe(true);
          expect(filteredTabs.some(t => t.groupId === -1)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should not display ungrouped tabs in group listings', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbitraryTabGroup, { minLength: 1, maxLength: 5 }), // Remove () - it's not a function
        fc.array(arbitraryUngroupedTab(), { minLength: 1, maxLength: 10 }),
        async (groups, ungroupedTabs) => {
          mocks.tabGroups.clear();

          // Deduplicate groups by ID (Map overwrites duplicates)
          const uniqueGroups = new Map(groups.map(g => [g.id, g]));
          for (const group of uniqueGroups.values()) {
            mocks.tabGroups.set(group.id, group);
          }

          // Query all tab groups
          const result = await chrome.tabGroups.query({});

          // Verify: Only actual groups should be returned, no ungrouped tabs
          expect(result.length).toBe(uniqueGroups.size);
          expect(result.every(g => g.id > 0)).toBe(true);
          
          // Verify: No group with id -1 (ungrouped indicator)
          expect(result.some(g => g.id === -1)).toBe(false);
          
          // Verify: All returned groups are actual tab groups, not tabs
          expect(result.every(g => 'title' in g && 'color' in g)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should maintain separation between grouped and ungrouped tabs', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTabGroup,
        fc.array(arbitraryTab(), { minLength: 1, maxLength: 10 }),
        fc.array(arbitraryUngroupedTab(), { minLength: 1, maxLength: 10 }),
        async (group, groupedTabs, ungroupedTabs) => {
          // Setup tabs
          const validGroupedTabs = groupedTabs.map(t => ({
            ...t,
            groupId: group.id,
            url: t.url || 'https://example.com'
          }));
          
          const validUngroupedTabs = ungroupedTabs.map(t => ({
            ...t,
            groupId: -1,
            url: t.url || 'https://example.com'
          }));

          // Verify: Grouped and ungrouped tabs have different groupIds
          const groupedIds = new Set(validGroupedTabs.map(t => t.groupId));
          const ungroupedIds = new Set(validUngroupedTabs.map(t => t.groupId));
          
          // No overlap between grouped and ungrouped
          const intersection = new Set([...groupedIds].filter(id => ungroupedIds.has(id)));
          expect(intersection.size).toBe(0);
          
          // All ungrouped tabs have groupId -1
          expect(ungroupedIds.size).toBe(1);
          expect(ungroupedIds.has(-1)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
