import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  filterGroupedTabs,
  filterUngroupedTabs,
  isTabGrouped,
  groupTabsByGroupId,
  isValidBookmarkUrl,
  filterBookmarkableTabs,
} from '../../../src/lib/utils/tabUtils';

describe('tabUtils', () => {
  describe('filterGroupedTabs', () => {
    it('should filter out ungrouped tabs', () => {
      const tabs = [
        { id: 1, groupId: 1, url: 'https://example.com' },
        { id: 2, groupId: -1, url: 'https://example.com' },
        { id: 3, groupId: 2, url: 'https://example.com' },
        { id: 4, url: 'https://example.com' }, // undefined groupId
      ] as chrome.tabs.Tab[];

      const result = filterGroupedTabs(tabs);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(3);
    });

    it('should return empty array when no grouped tabs', () => {
      const tabs = [
        { id: 1, groupId: -1, url: 'https://example.com' },
        { id: 2, url: 'https://example.com' },
      ] as chrome.tabs.Tab[];

      const result = filterGroupedTabs(tabs);

      expect(result).toHaveLength(0);
    });

    it('should handle empty array', () => {
      const result = filterGroupedTabs([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('filterUngroupedTabs', () => {
    it('should filter out grouped tabs', () => {
      const tabs = [
        { id: 1, groupId: 1, url: 'https://example.com' },
        { id: 2, groupId: -1, url: 'https://example.com' },
        { id: 3, groupId: 2, url: 'https://example.com' },
        { id: 4, url: 'https://example.com' },
      ] as chrome.tabs.Tab[];

      const result = filterUngroupedTabs(tabs);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(2);
      expect(result[1].id).toBe(4);
    });

    it('should return empty array when all tabs are grouped', () => {
      const tabs = [
        { id: 1, groupId: 1, url: 'https://example.com' },
        { id: 2, groupId: 2, url: 'https://example.com' },
      ] as chrome.tabs.Tab[];

      const result = filterUngroupedTabs(tabs);

      expect(result).toHaveLength(0);
    });
  });

  describe('isTabGrouped', () => {
    it('should return true for grouped tab', () => {
      const tab = { id: 1, groupId: 1, url: 'https://example.com' } as chrome.tabs.Tab;
      expect(isTabGrouped(tab)).toBe(true);
    });

    it('should return false for ungrouped tab with groupId -1', () => {
      const tab = { id: 1, groupId: -1, url: 'https://example.com' } as chrome.tabs.Tab;
      expect(isTabGrouped(tab)).toBe(false);
    });

    it('should return false for tab with undefined groupId', () => {
      const tab = { id: 1, url: 'https://example.com' } as chrome.tabs.Tab;
      expect(isTabGrouped(tab)).toBe(false);
    });
  });

  describe('groupTabsByGroupId', () => {
    it('should group tabs by their group ID', () => {
      const tabs = [
        { id: 1, groupId: 1, url: 'https://example.com/1' },
        { id: 2, groupId: 1, url: 'https://example.com/2' },
        { id: 3, groupId: 2, url: 'https://example.com/3' },
        { id: 4, groupId: 2, url: 'https://example.com/4' },
      ] as chrome.tabs.Tab[];

      const result = groupTabsByGroupId(tabs);

      expect(result.size).toBe(2);
      expect(result.get(1)).toHaveLength(2);
      expect(result.get(2)).toHaveLength(2);
      expect(result.get(1)?.[0].id).toBe(1);
      expect(result.get(1)?.[1].id).toBe(2);
    });

    it('should exclude ungrouped tabs', () => {
      const tabs = [
        { id: 1, groupId: 1, url: 'https://example.com' },
        { id: 2, groupId: -1, url: 'https://example.com' },
        { id: 3, url: 'https://example.com' },
      ] as chrome.tabs.Tab[];

      const result = groupTabsByGroupId(tabs);

      expect(result.size).toBe(1);
      expect(result.get(1)).toHaveLength(1);
    });

    it('should handle empty array', () => {
      const result = groupTabsByGroupId([]);
      expect(result.size).toBe(0);
    });
  });

  describe('isValidBookmarkUrl', () => {
    it('should return true for valid HTTP URLs', () => {
      const tab = { url: 'https://example.com' } as chrome.tabs.Tab;
      expect(isValidBookmarkUrl(tab)).toBe(true);
    });

    it('should return true for valid HTTPS URLs', () => {
      const tab = { url: 'http://example.com' } as chrome.tabs.Tab;
      expect(isValidBookmarkUrl(tab)).toBe(true);
    });

    it('should return false for chrome:// URLs', () => {
      const tab = { url: 'chrome://settings' } as chrome.tabs.Tab;
      expect(isValidBookmarkUrl(tab)).toBe(false);
    });

    it('should return false for chrome-extension:// URLs', () => {
      const tab = { url: 'chrome-extension://abc123/popup.html' } as chrome.tabs.Tab;
      expect(isValidBookmarkUrl(tab)).toBe(false);
    });

    it('should return false for about: URLs', () => {
      const tab = { url: 'about:blank' } as chrome.tabs.Tab;
      expect(isValidBookmarkUrl(tab)).toBe(false);
    });

    it('should return false for data: URLs', () => {
      const tab = { url: 'data:text/html,<h1>Test</h1>' } as chrome.tabs.Tab;
      expect(isValidBookmarkUrl(tab)).toBe(false);
    });

    it('should return false for javascript: URLs', () => {
      const tab = { url: 'javascript:alert("test")' } as chrome.tabs.Tab;
      expect(isValidBookmarkUrl(tab)).toBe(false);
    });

    it('should return false for tabs without URL', () => {
      const tab = {} as chrome.tabs.Tab;
      expect(isValidBookmarkUrl(tab)).toBe(false);
    });
  });

  describe('filterBookmarkableTabs', () => {
    it('should filter out tabs with invalid URLs', () => {
      const tabs = [
        { id: 1, url: 'https://example.com' },
        { id: 2, url: 'chrome://settings' },
        { id: 3, url: 'https://google.com' },
        { id: 4, url: 'about:blank' },
        { id: 5, url: 'chrome-extension://abc/popup.html' },
      ] as chrome.tabs.Tab[];

      const result = filterBookmarkableTabs(tabs);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(3);
    });

    it('should return empty array when no valid URLs', () => {
      const tabs = [
        { id: 1, url: 'chrome://settings' },
        { id: 2, url: 'about:blank' },
      ] as chrome.tabs.Tab[];

      const result = filterBookmarkableTabs(tabs);

      expect(result).toHaveLength(0);
    });

    it('should handle empty array', () => {
      const result = filterBookmarkableTabs([]);
      expect(result).toHaveLength(0);
    });
  });
});
