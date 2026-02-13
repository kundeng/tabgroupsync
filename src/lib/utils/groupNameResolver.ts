import { Logger } from './logger';

const logger = Logger.getInstance();

/**
 * Resolves a tab group name according to the extension's naming rules
 * 
 * Rules:
 * - undefined/null/empty string → null (group is unnamed/transient — do NOT sync)
 * - Whitespace-only string → null (group should be ignored)
 * - Valid string → returned as-is
 * 
 * @param title The tab group title to resolve
 * @returns The resolved name, or null if the group should be skipped
 */
export function resolveGroupName(title: string | undefined): string | null {
  // Handle undefined, null, or empty string — group is unnamed/transient
  if (title === undefined || title === null || title === '') {
    logger.logDecision(
      'Group skipped due to missing title',
      'Title is undefined, null, or empty — group is transient, not synced',
      { originalTitle: title }
    );
    return null;
  }
  
  // Check if title contains only whitespace - IGNORE these groups
  if (title.trim() === '') {
    logger.logDecision(
      'Group ignored due to whitespace-only title',
      'Title contains only whitespace characters',
      { originalTitle: title, titleLength: title.length }
    );
    return null;
  }
  
  // Valid title - return as-is
  return title;
}

/**
 * Checks if a group should be managed by the extension
 * 
 * @param title The tab group title
 * @returns true if the group should be managed, false otherwise
 */
export function shouldManageGroup(title: string | undefined): boolean {
  return resolveGroupName(title) !== null;
}
