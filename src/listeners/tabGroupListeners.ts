import { TabGroupManager } from '../lib/tabGroupManager';
import { Logger } from '../lib/utils/logger';
import { resolveGroupName } from '../lib/utils/groupNameResolver';

export function initializeTabGroupListeners(tabGroupManager: TabGroupManager, workerStartTime?: number): void {
  const logger = Logger.getInstance();
  const startTime = workerStartTime ?? Date.now();

  // Queue for handling group events
  let groupQueue: chrome.tabGroups.TabGroup[] = [];
  let processingQueue = false;

  async function processGroupQueue() {
    if (processingQueue || groupQueue.length === 0) return;
    
    processingQueue = true;
    try {
      const group = groupQueue.shift()!;
      await tabGroupManager.handleGroupVisible(group);
      logger.info('tabGroup:visible:handled', {
        groupId: group.id,
        title: group.title,
        type: 'created_or_restored'
      });
    } catch (error) {
      logger.error('tabGroup:queue:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      processingQueue = false;
      if (groupQueue.length > 0) {
        setTimeout(processGroupQueue, 1000); // Process next group after 1 second
      }
    }
  }

  chrome.tabGroups.onCreated.addListener((group) => {
    logger.debug('tabGroup:created', {
      groupId: group.id,
      title: group.title,
      windowId: group.windowId,
      timeSinceWorkerStart: Date.now() - startTime,
      queueSize: groupQueue.length
    });

    groupQueue.push(group);
    processGroupQueue();
  });

  // Debounce per-group updates so keystroke-level onUpdated storms (one event per
  // character while the user types a title) collapse into a single sync once the
  // title settles. Without this, typing "splunk" creates folders "s", "sp", "spl",
  // "splu", "splun", "splunk" — one per intermediate state.
  const UPDATE_DEBOUNCE_MS = 750;
  const updateTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const latestUpdateByGroupId = new Map<number, chrome.tabGroups.TabGroup>();

  chrome.tabGroups.onUpdated.addListener((group) => {
    logger.debug('tabGroup:updated', {
      groupId: group.id,
      title: group.title,
      windowId: group.windowId,
      color: group.color,
      timeSinceWorkerStart: Date.now() - startTime
    });

    // Always record the newest state for this group.
    latestUpdateByGroupId.set(group.id, group);

    // Reset the timer — the user might still be typing.
    const existing = updateTimers.get(group.id);
    if (existing) clearTimeout(existing);

    updateTimers.set(group.id, setTimeout(async () => {
      updateTimers.delete(group.id);
      const latest = latestUpdateByGroupId.get(group.id);
      latestUpdateByGroupId.delete(group.id);
      if (!latest) return;

      try {
        await tabGroupManager.handleGroupUpdated(latest);
        logger.info('tabGroup:updated:handled', {
          groupId: latest.id,
          title: latest.title,
          debounced: true
        });
      } catch (error) {
        logger.error('tabGroup:updated:failed', {
          groupId: latest.id,
          title: latest.title,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, error instanceof Error ? error : undefined);
      }
    }, UPDATE_DEBOUNCE_MS));
  });

  chrome.tabGroups.onRemoved.addListener(async (group) => {
    logger.debug('tabGroup:removed', {
      groupId: group.id,
      title: group.title,
      windowId: group.windowId,
      timeSinceWorkerStart: Date.now() - startTime
    });

    // Cancel any pending debounced update for a group that no longer exists.
    const pending = updateTimers.get(group.id);
    if (pending) {
      clearTimeout(pending);
      updateTimers.delete(group.id);
      latestUpdateByGroupId.delete(group.id);
    }

    try {
      // Pass group name to preserve folder mapping
      const name = resolveGroupName(group.title);
      if (name === null) {
        logger.info('tabGroup:removed:skipped', {
          groupId: group.id,
          reason: 'unnamed or whitespace-only title — was never synced'
        });
        return;
      }
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

  // Queue for handling group removals
  let removalQueue: { name: string, groupId: number }[] = [];
  let processingRemovals = false;

  async function processRemovalQueue() {
    if (processingRemovals || removalQueue.length === 0) return;
    
    processingRemovals = true;
    try {
      const item = removalQueue.shift()!;
      await tabGroupManager.handleGroupRemoved(item.name);
      logger.info('tabGroup:removed:handled', {
        groupId: item.groupId,
        name: item.name
      });
    } catch (error) {
      logger.error('tabGroup:removal:failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      processingRemovals = false;
      if (removalQueue.length > 0) {
        setTimeout(processRemovalQueue, 1000); // Process next removal after 1 second
      }
    }
  }

  // Handle window removal to properly handle groups in closed windows
  chrome.windows.onRemoved.addListener(async (windowId) => {
    logger.debug('window:removed', { windowId });
    
    try {
      // Get groups in the window before it's removed
      const groups = await chrome.tabGroups.query({ windowId });
      
      // Queue each group for removal (skip unnamed groups — never synced)
      groups.forEach(group => {
        const name = resolveGroupName(group.title);
        if (name === null) return;
        removalQueue.push({ name, groupId: group.id });
        logger.debug('window:removed:group:queued', {
          windowId,
          groupId: group.id,
          name
        });
      });

      processRemovalQueue();
    } catch (error) {
      logger.error('window:removed:failed', {
        windowId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, error instanceof Error ? error : undefined);
    }
  });

  logger.info('tabGroupListeners:initialized', { timestamp: Date.now() });
}
