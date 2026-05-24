import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('move-group portability', () => {
  it('uses only standard Chrome extension APIs for cross-window move', () => {
    const tabGroupManager = readFileSync('src/lib/tabGroupManager.ts', 'utf8');
    const background = readFileSync('src/background.ts', 'utf8');

    expect(tabGroupManager).toContain('chrome.tabs.move');
    expect(tabGroupManager).toContain('chrome.tabs.group');
    expect(tabGroupManager).toContain('chrome.tabGroups.update');
    expect(background).toContain('MOVE_GROUP_TO_WINDOW');
    expect(background).toContain('chrome.windows.getAll');

    const forbiddenApis = [
      /chrome\.workspaces\./,
      /chrome\.edge\./,
      /browser\.windows\./,
      /msBrowser\./,
    ];

    for (const pattern of forbiddenApis) {
      expect(tabGroupManager).not.toMatch(pattern);
      expect(background).not.toMatch(pattern);
    }
  });
});
