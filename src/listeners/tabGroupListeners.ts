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
      await tabGroupManager.handleGroupRemoved(group.id);
      logger.info('tabGroup:removed:handled', {
        groupId: group.id,
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

  logger.info('tabGroupListeners:initialized', { timestamp: Date.now() });
}
