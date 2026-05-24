import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { Logger } from '../../../src/lib/utils/logger';

/**
 * Property 30: Automatic Decision Logging
 * 
 * For any automatic decision made by the system (auto-sync enabling, folder recreation,
 * cleanup actions), the Logger should record the decision and the reasoning behind it
 * 
 * Validates: Requirements 11.4
 */

describe('Property 30: Automatic Decision Logging', () => {
  let logger: Logger;
  let consoleLogSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = Logger.getInstance();
    consoleLogSpy = vi.spyOn(console, 'log');
  });

  it('should log automatic decisions with reasoning', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.record({
          groupName: fc.string({ minLength: 1, maxLength: 50 }),
          autoSyncEnabled: fc.boolean()
        }),
        async (decision, reasoning, context) => {
          logger.logDecision(decision, reasoning, context);

          // Verify: Console.log was called
          expect(consoleLogSpy).toHaveBeenCalled();

          // Verify: Decision is logged
          const logCalls = consoleLogSpy.mock.calls;
          const hasDecision = logCalls.some(call =>
            JSON.stringify(call).includes('DECISION')
          );
          expect(hasDecision).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should include reasoning in decision logs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        async (decision, reasoning) => {
          consoleLogSpy.mockClear();

          logger.logDecision(decision, reasoning, {});

          // Verify: Reasoning is logged
          expect(consoleLogSpy).toHaveBeenCalled();
          
          // Find the DECISION log call
          const logCalls = consoleLogSpy.mock.calls;
          const decisionLog = logCalls.find(call => 
            call[0] && typeof call[0] === 'string' && call[0].includes('[DECISION]')
          );
          
          expect(decisionLog).toBeDefined();
          
          // Check the logged object (second parameter)
          const loggedData = decisionLog![1];
          expect(loggedData).toBeDefined();
          expect(loggedData.reasoning).toBe(reasoning);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should log context with automatic decisions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.record({
          groupName: fc.string({ minLength: 1, maxLength: 50 }),
          containerFolderId: fc.string({ minLength: 1, maxLength: 20 }),
          autoSyncEnabled: fc.boolean()
        }),
        async (decision, context) => {
          consoleLogSpy.mockClear();

          logger.logDecision(decision, 'test reasoning', context);

          // Verify: Context is logged
          expect(consoleLogSpy).toHaveBeenCalled();
          
          // Find the DECISION log call
          const logCalls = consoleLogSpy.mock.calls;
          const decisionLog = logCalls.find(call => 
            call[0] && typeof call[0] === 'string' && call[0].includes('[DECISION]')
          );
          
          expect(decisionLog).toBeDefined();
          
          // Check the logged object (second parameter)
          const loggedData = decisionLog![1];
          expect(loggedData).toBeDefined();
          expect(loggedData.context).toBeDefined();
          expect(loggedData.context.groupName).toBe(context.groupName);
          expect(loggedData.context.containerFolderId).toBe(context.containerFolderId);
          expect(loggedData.context.autoSyncEnabled).toBe(context.autoSyncEnabled);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
