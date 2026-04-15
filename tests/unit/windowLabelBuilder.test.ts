import { describe, expect, it } from 'vitest';
import { buildWindowLabels, WindowLabel } from '../../src/lib/utils/windowLabelBuilder';

// Helper to build a minimal chrome.windows.Window
function makeWindow(
  id: number,
  focused: boolean,
  tabs: Partial<chrome.tabs.Tab>[] = []
): chrome.windows.Window {
  return {
    id,
    focused,
    tabs: tabs.map((t, i) => ({
      id: t.id ?? i + 100,
      index: t.index ?? i,
      windowId: id,
      active: t.active ?? false,
      pinned: false,
      highlighted: false,
      incognito: false,
      groupId: t.groupId ?? -1,
      title: t.title,
      url: t.url,
    })) as chrome.tabs.Tab[],
  } as chrome.windows.Window;
}

// Helper to build a minimal chrome.tabGroups.TabGroup
function makeTabGroup(
  id: number,
  windowId: number,
  title: string
): chrome.tabGroups.TabGroup {
  return {
    id,
    windowId,
    title,
    color: 'blue' as chrome.tabGroups.ColorEnum,
    collapsed: false,
  };
}

describe('buildWindowLabels', () => {
  it('returns empty array for empty input', () => {
    expect(buildWindowLabels([], [])).toEqual([]);
  });

  it('labels window by tab group names (tier 1)', () => {
    const windows = [makeWindow(1, false, [{ groupId: 10 }, { groupId: 20 }])];
    const tabGroups = [
      makeTabGroup(10, 1, 'Work'),
      makeTabGroup(20, 1, 'Research'),
    ];

    const labels = buildWindowLabels(windows, tabGroups);
    expect(labels).toHaveLength(1);
    expect(labels[0].label).toBe('Work, Research');
    expect(labels[0].tabCount).toBe(2);
    expect(labels[0].windowId).toBe(1);
  });

  it('deduplicates group names', () => {
    const windows = [makeWindow(1, false, [{ groupId: 10 }, { groupId: 20 }])];
    const tabGroups = [
      makeTabGroup(10, 1, 'Work'),
      makeTabGroup(20, 1, 'Work'),
    ];

    const labels = buildWindowLabels(windows, tabGroups);
    expect(labels[0].label).toBe('Work');
  });

  it('skips groups with empty or whitespace-only titles', () => {
    const windows = [makeWindow(1, false, [
      { groupId: 10, active: true, title: 'GitHub', url: 'https://github.com' },
      { groupId: 20 },
    ])];
    const tabGroups = [
      makeTabGroup(10, 1, ''),
      makeTabGroup(20, 1, '   '),
    ];

    const labels = buildWindowLabels(windows, tabGroups);
    // Should fall through to tier 2 since no valid group names
    expect(labels[0].label).toBe('GitHub');
  });

  it('falls back to active tab title (tier 2) when no groups', () => {
    const windows = [makeWindow(1, false, [
      { active: true, title: 'Pull Requests · GitHub', url: 'https://github.com/pulls' },
      { active: false, title: 'Other Tab' },
    ])];

    const labels = buildWindowLabels(windows, []);
    expect(labels[0].label).toBe('Pull Requests · GitHub');
  });

  it('truncates long active tab titles', () => {
    const longTitle = 'A'.repeat(60);
    const windows = [makeWindow(1, false, [
      { active: true, title: longTitle, url: 'https://example.com' },
    ])];

    const labels = buildWindowLabels(windows, []);
    expect(labels[0].label.length).toBeLessThanOrEqual(40);
    expect(labels[0].label).toContain('…');
  });

  it('falls back to active tab domain when title is empty (tier 2)', () => {
    const windows = [makeWindow(1, false, [
      { active: true, title: '', url: 'https://github.com/pulls' },
    ])];

    const labels = buildWindowLabels(windows, []);
    expect(labels[0].label).toBe('github.com');
  });

  it('falls back to generic label (tier 3) when no groups and no useful active tab', () => {
    const windows = [makeWindow(1, false, [
      { active: false, title: 'Tab 1' },
      { active: false, title: 'Tab 2' },
      { active: false, title: 'Tab 3' },
    ])];

    const labels = buildWindowLabels(windows, []);
    expect(labels[0].label).toBe('Window — 3 tabs');
  });

  it('shows singular "tab" for single-tab window', () => {
    const windows = [makeWindow(1, false, [
      { active: false },
    ])];

    const labels = buildWindowLabels(windows, []);
    expect(labels[0].label).toBe('Window — 1 tab');
  });

  it('shows generic label for window with no tabs', () => {
    const windows = [makeWindow(1, false, [])];

    const labels = buildWindowLabels(windows, []);
    expect(labels[0].label).toBe('Window — 0 tabs');
  });

  it('sets isFocused correctly', () => {
    const windows = [
      makeWindow(1, true, [{ active: true, title: 'Focused' }]),
      makeWindow(2, false, [{ active: true, title: 'Not focused' }]),
    ];

    const labels = buildWindowLabels(windows, []);
    expect(labels[0].isFocused).toBe(true);
    expect(labels[1].isFocused).toBe(false);
  });

  it('caps displayed group names when many groups exist', () => {
    const windows = [makeWindow(1, false, [
      { groupId: 10 }, { groupId: 20 }, { groupId: 30 },
      { groupId: 40 }, { groupId: 50 },
    ])];
    const tabGroups = [
      makeTabGroup(10, 1, 'Alpha'),
      makeTabGroup(20, 1, 'Beta'),
      makeTabGroup(30, 1, 'Gamma'),
      makeTabGroup(40, 1, 'Delta'),
      makeTabGroup(50, 1, 'Epsilon'),
    ];

    const labels = buildWindowLabels(windows, tabGroups);
    // Should show first 3 + "+2 more"
    expect(labels[0].label).toBe('Alpha, Beta, Gamma +2 more');
  });

  it('handles multiple windows correctly', () => {
    const windows = [
      makeWindow(1, true, [{ groupId: 10 }]),
      makeWindow(2, false, [{ active: true, title: 'Docs', url: 'https://docs.google.com' }]),
    ];
    const tabGroups = [makeTabGroup(10, 1, 'Work')];

    const labels = buildWindowLabels(windows, tabGroups);
    expect(labels).toHaveLength(2);
    expect(labels[0].label).toBe('Work');
    expect(labels[0].isFocused).toBe(true);
    expect(labels[1].label).toBe('Docs');
    expect(labels[1].isFocused).toBe(false);
  });

  it('ignores tab groups from other windows', () => {
    const windows = [makeWindow(1, false, [
      { active: true, title: 'My Page', url: 'https://example.com' },
    ])];
    // Tab group belongs to window 2, not window 1
    const tabGroups = [makeTabGroup(10, 2, 'Other Window Group')];

    const labels = buildWindowLabels(windows, tabGroups);
    expect(labels[0].label).toBe('My Page');
  });
});
