import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { Logger } from '../../../src/lib/utils/logger';

/**
 * Property 29: State Change Logging
 * 
 * For any state change in the system, the Logger should record both the before
 * and after states along with the reason for the change
 * 
 * Validates: Requirements 11.3
 */

describe('Feature: tab-group-sync, Property 29: State Change Logging', () => {
  let logger: Logger;
  let consoleLogSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = Logger.getInstance();
    consoleLogSpy = vi.spyOn(console, 'log');
  });

  it('should log before and after states with reason', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
        fc.record({ syncEnabled: fc.boolean(), value: fc.integer() }),
        fc.record({ syncEnabled: fc.boolean(), value: fc.integer() }),
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        async (component, beforeState, afterState, reason) => {
          consoleLogSpy.mockClear();
          
          logger.logStateChange(component, beforeState, afterState, reason);

          // Verify: Console.log was called
          expect(consoleLogSpy).toHaveBeenCalled();

          // Verify: STATE_CHANGE tag is present
          const logCalls = consoleLogSpy.mock.calls;
          const stateChangeCall = logCalls.find(call => {
            const firstArg = call[0];
            return typeof firstArg === 'string' && firstArg.includes('STATE_CHANGE');
          });
          expect(stateChangeCall).toBeDefined();

          // Verify: Before state is logged
          const hasBeforeState = logCalls.some(call => {
            const secondArg = call[1];
            return secondArg && typeof secondArg === 'object' && 
                   'before' in secondArg && 
                   JSON.stringify(secondArg.before) === JSON.stringify(beforeState);
          });
          expect(hasBeforeState).toBe(true);

          // Verify: After state is logged
          const hasAfterState = logCalls.some(call => {
            const secondArg = call[1];
            return secondArg && typeof secondArg === 'object' && 
                   'after' in secondArg && 
                   JSON.stringify(secondArg.after) === JSON.stringify(afterState);
          });
          expect(hasAfterState).toBe(true);

          // Verify: Reason is logged
          const hasReason = logCalls.some(call => {
            const secondArg = call[1];
            return secondArg && typeof secondArg === 'object' && 
                   'reason' in secondArg && secondArg.reason === reason;
          });
          expect(hasReason).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should include component name in state change logs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
        fc.record({ value: fc.integer() }),
        fc.record({ value: fc.integer() }),
        async (component, beforeState, afterState) => {
          consoleLogSpy.mockClear();

          logger.logStateChange(component, beforeState, afterState, 'test reason');

          // Verify: Console.log was called
          expect(consoleLogSpy).toHaveBeenCalled();
          
          // Verify: Component name is logged in the first argument
          const logCalls = consoleLogSpy.mock.calls;
          const hasComponent = logCalls.some(call => {
            const firstArg = call[0];
            return typeof firstArg === 'string' && firstArg.includes(component);
          });
          expect(hasComponent).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should log reason for state changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        async (reason) => {
          consoleLogSpy.mockClear();

          logger.logStateChange(
            'TestComponent',
            { value: 1 },
            { value: 2 },
            reason
          );

          // Verify: Console.log was called
          expect(consoleLogSpy).toHaveBeenCalled();
          
          // Verify: Reason is logged in the second argument (the object)
          const logCalls = consoleLogSpy.mock.calls;
          const hasReason = logCalls.some(call => {
            const secondArg = call[1];
            return secondArg && typeof secondArg === 'object' && 
                   'reason' in secondArg && secondArg.reason === reason;
          });
          expect(hasReason).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should log complex state objects correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          syncEnabled: fc.boolean(),
          lastSynced: fc.integer({ min: 0, max: Date.now() }),
          groupName: fc.string({ minLength: 1, maxLength: 50 }),
          tabCount: fc.integer({ min: 0, max: 100 }),
        }),
        fc.record({
          syncEnabled: fc.boolean(),
          lastSynced: fc.integer({ min: 0, max: Date.now() }),
          groupName: fc.string({ minLength: 1, maxLength: 50 }),
          tabCount: fc.integer({ min: 0, max: 100 }),
        }),
        async (beforeState, afterState) => {
          consoleLogSpy.mockClear();

          logger.logStateChange('StorageManager', beforeState, afterState, 'User toggled sync');

          // Verify: Both states are logged with all properties
          expect(consoleLogSpy).toHaveBeenCalled();
          
          const logCalls = consoleLogSpy.mock.calls;
          const stateChangeCall = logCalls.find(call => {
            const secondArg = call[1];
            return secondArg && 
                   'before' in secondArg && 
                   'after' in secondArg &&
                   'reason' in secondArg;
          });
          
          expect(stateChangeCall).toBeDefined();
          expect(stateChangeCall![1].before).toEqual(beforeState);
          expect(stateChangeCall![1].after).toEqual(afterState);
          expect(stateChangeCall![1].reason).toBe('User toggled sync');
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should handle null and undefined in state objects', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          value: fc.option(fc.integer(), { nil: null }),
          optional: fc.option(fc.string(), { nil: undefined }),
        }),
        fc.record({
          value: fc.option(fc.integer(), { nil: null }),
          optional: fc.option(fc.string(), { nil: undefined }),
        }),
        async (beforeState, afterState) => {
          consoleLogSpy.mockClear();

          logger.logStateChange('TestComponent', beforeState, afterState, 'State update');

          // Verify: Logging doesn't throw and captures null/undefined values
          expect(consoleLogSpy).toHaveBeenCalled();
          
          const logCalls = consoleLogSpy.mock.calls;
          const stateChangeCall = logCalls.find(call => {
            const secondArg = call[1];
            return secondArg && 'before' in secondArg && 'after' in secondArg;
          });
          
          expect(stateChangeCall).toBeDefined();
          // Verify the states are captured correctly even with null/undefined
          expect(stateChangeCall![1].before).toEqual(beforeState);
          expect(stateChangeCall![1].after).toEqual(afterState);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
