import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveGroupName, shouldManageGroup } from '../../../src/lib/utils/groupNameResolver';
import { Logger } from '../../../src/lib/utils/logger';

describe('groupNameResolver', () => {
  beforeEach(() => {
    // Clear any previous logger state
    vi.clearAllMocks();
  });

  describe('resolveGroupName', () => {
    // Unnamed groups are transient — return null (do NOT sync)
    it('should return null for undefined title (unnamed/transient group)', () => {
      const result = resolveGroupName(undefined);
      expect(result).toBeNull();
    });

    it('should return null for empty string (unnamed/transient group)', () => {
      const result = resolveGroupName('');
      expect(result).toBeNull();
    });

    // Whitespace-only groups should be IGNORED (return null)
    it('should return null for whitespace-only title (single space)', () => {
      const result = resolveGroupName(' ');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only title (multiple spaces)', () => {
      const result = resolveGroupName('   ');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only title (tabs)', () => {
      const result = resolveGroupName('\t\t');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only title (newlines)', () => {
      const result = resolveGroupName('\n\n');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only title (mixed whitespace)', () => {
      const result = resolveGroupName(' \t\n ');
      expect(result).toBeNull();
    });

    it('should return the title as-is for valid non-empty title', () => {
      const result = resolveGroupName('Work Tabs');
      expect(result).toBe('Work Tabs');
    });

    it('should return the title as-is for title with leading/trailing spaces', () => {
      const result = resolveGroupName(' Work Tabs ');
      expect(result).toBe(' Work Tabs ');
    });

    it('should return the title as-is for title with internal whitespace', () => {
      const result = resolveGroupName('Work  Tabs');
      expect(result).toBe('Work  Tabs');
    });

    it('should return the title as-is for single character title', () => {
      const result = resolveGroupName('A');
      expect(result).toBe('A');
    });

    it('should return the title as-is for numeric title', () => {
      const result = resolveGroupName('123');
      expect(result).toBe('123');
    });

    it('should return the title as-is for special characters', () => {
      const result = resolveGroupName('Work-Tabs_2024!');
      expect(result).toBe('Work-Tabs_2024!');
    });
  });

  describe('shouldManageGroup', () => {
    it('should return false for undefined title (unnamed/transient group)', () => {
      const result = shouldManageGroup(undefined);
      expect(result).toBe(false);
    });

    it('should return false for empty string (unnamed/transient group)', () => {
      const result = shouldManageGroup('');
      expect(result).toBe(false);
    });

    it('should return false for whitespace-only title', () => {
      const result = shouldManageGroup('   ');
      expect(result).toBe(false);
    });

    it('should return false for tab-only title', () => {
      const result = shouldManageGroup('\t');
      expect(result).toBe(false);
    });

    it('should return true for valid title', () => {
      const result = shouldManageGroup('Work Tabs');
      expect(result).toBe(true);
    });

    it('should return true for single character title', () => {
      const result = shouldManageGroup('A');
      expect(result).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle zero-width space as valid title', () => {
      // Zero-width space is not considered whitespace by trim()
      const result = resolveGroupName('\u200B');
      expect(result).toBe('\u200B');
    });

    it('should handle non-breaking space', () => {
      const result = resolveGroupName('\u00A0');
      expect(result).toBeNull();
    });

    it('should handle emoji as valid title', () => {
      const result = resolveGroupName('🚀');
      expect(result).toBe('🚀');
    });

    it('should handle unicode characters as valid title', () => {
      const result = resolveGroupName('工作标签');
      expect(result).toBe('工作标签');
    });
  });
});
