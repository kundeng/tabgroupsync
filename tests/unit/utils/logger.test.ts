import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, OperationDetails } from '../../../src/lib/utils/logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;
  let consoleDebugSpy: any;
  let performanceMarkSpy: any;
  let performanceMeasureSpy: any;

  beforeEach(() => {
    logger = Logger.getInstance();
    consoleLogSpy = vi.spyOn(console, 'log');
    consoleErrorSpy = vi.spyOn(console, 'error');
    consoleWarnSpy = vi.spyOn(console, 'warn');
    consoleDebugSpy = vi.spyOn(console, 'debug');
    performanceMarkSpy = vi.spyOn(performance, 'mark');
    performanceMeasureSpy = vi.spyOn(performance, 'measure');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = Logger.getInstance();
      const instance2 = Logger.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('logOperation', () => {
    it('should log operation with structured details', () => {
      const details: OperationDetails = {
        operation: 'sync',
        target: {
          type: 'group',
          id: '123',
          name: 'Test Group',
        },
        outcome: 'success',
        duration: 245,
        metadata: { tabCount: 12 },
      };

      logger.logOperation('sync-group-to-folder', details);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[OPERATION] sync-group-to-folder'),
        expect.objectContaining({
          target: details.target,
          outcome: 'success',
          duration: 245,
          metadata: { tabCount: 12 },
        })
      );
    });

    it('should create performance marks when duration is provided', () => {
      const details: OperationDetails = {
        operation: 'sync',
        target: { type: 'group', name: 'Test' },
        outcome: 'success',
        duration: 100,
      };

      logger.logOperation('test-operation', details);

      expect(performanceMarkSpy).toHaveBeenCalledTimes(2);
      expect(performanceMeasureSpy).toHaveBeenCalledWith(
        'operation:test-operation',
        expect.stringContaining('test-operation'),
        expect.stringContaining('test-operation')
      );
    });

    it('should not create performance marks when duration is undefined', () => {
      const details: OperationDetails = {
        operation: 'sync',
        target: { type: 'group' },
        outcome: 'success',
      };

      logger.logOperation('test-operation', details);

      expect(performanceMarkSpy).not.toHaveBeenCalled();
      expect(performanceMeasureSpy).not.toHaveBeenCalled();
    });

    it('should handle performance API errors gracefully', () => {
      performanceMarkSpy.mockImplementation(() => {
        throw new Error('Performance API not available');
      });

      const details: OperationDetails = {
        operation: 'sync',
        target: { type: 'group' },
        outcome: 'success',
        duration: 100,
      };

      expect(() => logger.logOperation('test', details)).not.toThrow();
    });
  });

  describe('error', () => {
    it('should log error with Error object', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.ts:1:1';

      logger.error('sync:operation', error, { groupId: '123' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] sync:operation'),
        expect.objectContaining({
          error: {
            message: 'Test error',
            stack: expect.stringContaining('Error: Test error'),
            name: 'Error',
          },
          context: { groupId: '123' },
        })
      );
    });

    it('should log error with non-Error object', () => {
      const error = 'String error';

      logger.error('sync:operation', error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] sync:operation'),
        expect.objectContaining({
          error: 'String error',
        })
      );
    });

    it('should include stack trace for Error objects', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.ts:1:1';

      logger.error('test-context', error);

      const call = consoleErrorSpy.mock.calls[0];
      expect(call[1].error.stack).toContain('Error: Test error');
    });

    it('should handle additional context', () => {
      const error = new Error('Test');
      const context = { userId: '456', action: 'sync' };

      logger.error('test', error, context);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          context,
        })
      );
    });
  });

  describe('logStateChange', () => {
    it('should log state changes with before and after states', () => {
      const before = { syncEnabled: false };
      const after = { syncEnabled: true };
      const reason = 'User toggled sync';

      logger.logStateChange('StorageManager', before, after, reason);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[STATE_CHANGE] StorageManager'),
        expect.objectContaining({
          before,
          after,
          reason,
        })
      );
    });

    it('should handle complex state objects', () => {
      const before = {
        groups: { group1: { syncEnabled: false } },
        settings: { autoSync: false },
      };
      const after = {
        groups: { group1: { syncEnabled: true } },
        settings: { autoSync: true },
      };

      logger.logStateChange('SyncEngine', before, after, 'Settings updated');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[STATE_CHANGE]'),
        expect.objectContaining({ before, after })
      );
    });
  });

  describe('logDecision', () => {
    it('should log automatic decisions with reasoning', () => {
      const decision = 'Auto-sync enabled for new group';
      const reasoning = 'Auto-sync setting is enabled and container folder is configured';
      const context = { groupName: 'New Project', autoSyncEnabled: true };

      logger.logDecision(decision, reasoning, context);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DECISION] Auto-sync enabled for new group'),
        expect.objectContaining({
          reasoning,
          context,
        })
      );
    });

    it('should log folder recreation decisions', () => {
      const decision = 'Recreating container folder';
      const reasoning = 'Container folder was deleted but tab groups still exist';
      const context = { deletedFolderId: '123', existingGroupCount: 5 };

      logger.logDecision(decision, reasoning, context);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DECISION]'),
        expect.objectContaining({ reasoning, context })
      );
    });
  });

  describe('General logging methods', () => {
    it('should log info messages', () => {
      logger.info('Test info message', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Test info message'),
        { key: 'value' }
      );
    });

    it('should log warn messages', () => {
      logger.warn('Test warning', { warning: 'details' });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] Test warning'),
        { warning: 'details' }
      );
    });

    it('should log debug messages', () => {
      logger.debug('Test debug', { debug: 'info' });

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] Test debug'),
        { debug: 'info' }
      );
    });

    it('should handle logging without context', () => {
      logger.info('Simple message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Simple message'),
        {}
      );
    });
  });

  describe('Performance timing', () => {
    it('should start timing and create performance mark', () => {
      const markName = logger.startTiming('sync-operation');

      expect(markName).toMatch(/^sync-operation-\d+$/);
      expect(performanceMarkSpy).toHaveBeenCalledWith(
        expect.stringContaining('sync-operation')
      );
    });

    it('should end timing and create performance mark', () => {
      const markName = logger.startTiming('test-operation');
      
      // Clear previous calls from startTiming
      performanceMarkSpy.mockClear();

      logger.endTiming(markName, 'test-operation');

      expect(performanceMarkSpy).toHaveBeenCalledWith(`${markName}-end`);
    });

    it('should handle performance API errors in startTiming', () => {
      performanceMarkSpy.mockImplementation(() => {
        throw new Error('Performance API error');
      });

      expect(() => logger.startTiming('test')).not.toThrow();
    });

    it('should handle performance API errors in endTiming', () => {
      performanceMarkSpy.mockImplementation(() => {
        throw new Error('Performance API error');
      });

      expect(() => logger.endTiming('test-123', 'test')).not.toThrow();
    });

    it('should create unique mark names for concurrent operations', async () => {
      const mark1 = logger.startTiming('operation');
      // Small delay to ensure different timestamps (2ms to guarantee different Date.now())
      await new Promise(resolve => setTimeout(resolve, 2));
      const mark2 = logger.startTiming('operation');

      expect(mark1).not.toBe(mark2);
    });
  });

  describe('Timestamp formatting', () => {
    it('should include ISO timestamp in all log messages', () => {
      logger.info('Test message');

      const call = consoleLogSpy.mock.calls[0][0];
      expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });
  });
});
