/**
 * Builds human-friendly labels for browser windows.
 *
 * Label priority:
 *   1. Tab group names in the window (comma-separated, capped)
 *   2. Active tab title or domain
 *   3. Generic "Window — N tabs"
 */

/** Maximum number of group names shown before truncating */
const MAX_DISPLAYED_GROUPS = 3;

/** Maximum characters for an active-tab title before truncation */
const MAX_TITLE_LENGTH = 40;

export interface WindowLabel {
  windowId: number;
  label: string;
  tabCount: number;
  isFocused: boolean;
}

/**
 * Extract domain from a URL string, returning null on failure.
 */
function extractDomain(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname;
    return hostname || null;
  } catch {
    return null;
  }
}

/**
 * Truncate a string to maxLen characters, appending "…" if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/**
 * Build a human-readable label for each window.
 *
 * @param windows  - Result of chrome.windows.getAll({ populate: true })
 * @param tabGroups - Result of chrome.tabGroups.query({})
 * @returns One WindowLabel per input window (same order).
 */
export function buildWindowLabels(
  windows: chrome.windows.Window[],
  tabGroups: chrome.tabGroups.TabGroup[]
): WindowLabel[] {
  // Index tab groups by windowId for O(1) lookup
  const groupsByWindow = new Map<number, chrome.tabGroups.TabGroup[]>();
  for (const tg of tabGroups) {
    if (tg.windowId === undefined) continue;
    const list = groupsByWindow.get(tg.windowId) ?? [];
    list.push(tg);
    groupsByWindow.set(tg.windowId, list);
  }

  return windows.map((win) => {
    const windowId = win.id!;
    const tabs = win.tabs ?? [];
    const tabCount = tabs.length;
    const isFocused = !!win.focused;

    // Tier 1: tab group names
    const groups = groupsByWindow.get(windowId);
    if (groups && groups.length > 0) {
      const names = groups
        .map((g) => g.title)
        .filter((t): t is string => !!t && t.trim().length > 0);

      // Deduplicate while preserving order
      const unique = [...new Set(names)];

      if (unique.length > 0) {
        const displayed = unique.slice(0, MAX_DISPLAYED_GROUPS);
        const extra = unique.length - displayed.length;
        const label = extra > 0
          ? `${displayed.join(', ')} +${extra} more`
          : displayed.join(', ');

        return { windowId, label, tabCount, isFocused };
      }
    }

    // Tier 2: active tab title or domain
    const activeTab = tabs.find((t) => t.active);
    if (activeTab) {
      const title = activeTab.title?.trim();
      if (title) {
        return {
          windowId,
          label: truncate(title, MAX_TITLE_LENGTH),
          tabCount,
          isFocused,
        };
      }
      const domain = extractDomain(activeTab.url);
      if (domain) {
        return { windowId, label: domain, tabCount, isFocused };
      }
    }

    // Tier 3: generic fallback
    return {
      windowId,
      label: `Window — ${tabCount} tab${tabCount !== 1 ? 's' : ''}`,
      tabCount,
      isFocused,
    };
  });
}
