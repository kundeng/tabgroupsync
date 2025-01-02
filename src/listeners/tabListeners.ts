import { TabGroupManager } from '../lib/tabGroupManager';
import { Logger } from '../lib/utils/logger';

export function initializeTabListeners(tabGroupManager: TabGroupManager): void {
  const logger = Logger.getInstance();

  chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
    logger.debug('tab:attached', {
      tabId,
      newWindowId: attachInfo.newWindowId,
      newPosition: attachInfo.newPosition
    });

    try {
      await tabGroupManager.handleTabAttached(tabId, attachInfo);
      logger.info('tab:attached:handled', { tabId });
    } catch (error) {
      logger.error('tab:attached:failed', {
        tabId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
    }
  });

  chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
    logger.debug('tab:detached', {
      tabId,
      oldWindowId: detachInfo.oldWindowId,
      oldPosition: detachInfo.oldPosition
    });

    try {
      await tabGroupManager.handleTabDetached(tabId, detachInfo);
      logger.info('tab:detached:handled', { tabId });
    } catch (error) {
      logger.error('tab:detached:failed', {
        tabId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
    }
  });

  // Log when tabs are moved between groups
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.groupId !== undefined) {
      logger.debug('tab:groupUpdated', {
        tabId,
        oldGroupId: changeInfo.groupId,
        newGroupId: tab.groupId,
        url: tab.url,
        title: tab.title
      });
    }
  });

  logger.info('tabListeners:initialized', { timestamp: Date.now() });
}
