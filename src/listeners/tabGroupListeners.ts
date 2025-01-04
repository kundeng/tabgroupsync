import { TabGroupManager } from '../lib/tabGroupManager';
import { Logger } from '../lib/utils/logger';

export function initializeTabGroupListeners(tabGroupManager: TabGroupManager): void {
  const logger = Logger.getInstance();

  chrome.tabGroups.onCreated.addListener(async (group) => {
    logger.debug('tabGroup:created', {
      groupId: group.id,
      title: group.title,
      windowId: group.windowId
    });

    try {
      await tabGroupManager.handleGroupCreated(group);
      logger.info('tabGroup:created:handled', {
        groupId: group.id,
        title: group.title
      });
    } catch (error) {
      logger.error('tabGroup:created:failed', {
        groupId: group.id,
        title: group.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
    }
  });

  chrome.tabGroups.onUpdated.addListener(async (group) => {
    logger.debug('tabGroup:updated', {
      groupId: group.id,
      title: group.title,
      windowId: group.windowId,
      color: group.color
    });

    try {
      await tabGroupManager.handleGroupUpdated(group);
      logger.info('tabGroup:updated:handled', {
        groupId: group.id,
        title: group.title
      });
    } catch (error) {
      logger.error('tabGroup:updated:failed', {
        groupId: group.id,
        title: group.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
    }
  });

  chrome.tabGroups.onRemoved.addListener(async (group) => {
    logger.debug('tabGroup:removed', {
      groupId: group.id,
      title: group.title,
      windowId: group.windowId
    });

    try {
      // Pass group name to preserve folder mapping
      const name = group.title || 'Unnamed Group';
      await tabGroupManager.handleGroupRemoved(name);
      logger.info('tabGroup:removed:handled', {
        groupId: group.id,
        name,
        title: group.title
      });
    } catch (error) {
      logger.error('tabGroup:removed:failed', {
        groupId: group.id,
        title: group.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
    }
  });

  // Handle window removal to properly handle groups in closed windows
  chrome.windows.onRemoved.addListener(async (windowId) => {
    logger.debug('window:removed', { windowId });
    
    try {
      // Get groups in the window before it's removed
      const groups = await chrome.tabGroups.query({ windowId });
      
      // Handle each group removal
      for (const group of groups) {
        const name = group.title || 'Unnamed Group';
        await tabGroupManager.handleGroupRemoved(name);
        logger.info('window:removed:group:handled', {
          windowId,
          groupId: group.id,
          name
        });
      }
    } catch (error) {
      logger.error('window:removed:failed', {
        windowId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
    }
  });

  logger.info('tabGroupListeners:initialized', { timestamp: Date.now() });
}
