import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { Logger } from '../../../src/lib/utils/logger';

/**
 * Property 28: Error Logging with Context
 * 
 * For any error that occurs, the Logger should record detailed error information
 * including the error message, stack trace, and contextual information about
 * what operation was being performed
 * 
 * Validates: Requirements 11.2
 */

describe('Property 28: Error Logging with Context', () => {
  let logger: Logger;
  let consoleErrorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = Logger.getInstance();
    consoleErrorSpy = vi.spyOn(console, 'error');
  });

  it('should log error messages with context', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        async (context, errorMessage) => {
          consoleErrorSpy.mockClear();
          const error = new Error(errorMessage);

          logger.error(context, error);

          // Verify: Console.error was called
          expect(consoleErrorSpy).toHaveBeenCalled();

          // Verify: Context is included in the first argument (the log message)
          const errorCalls = consoleErrorSpy.mock.calls;
          expect(errorCalls.length).toBeGreaterThan(0);
          
          // The context should be in the first argument of console.error
          const firstCall = errorCalls[0];
          expect(firstCall[0]).toContain(context);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should include error details in logs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        async (errorMessage) => {
          consoleErrorSpy.mockClear();
          const error = new Error(errorMessage);

          logger.error('test-context', error);

          // Verify: Error message is logged
          expect(consoleErrorSpy).toHaveBeenCalled();
          
          // The error details should be in the second argument (the error object)
          const errorCalls = consoleErrorSpy.mock.calls;
          expect(errorCalls.length).toBeGreaterThan(0);
          
          const loggedData = errorCalls[0][1];
          expect(loggedData).toBeDefined();
          expect(loggedData.error).toBeDefined();
          expect(loggedData.error.message).toBe(errorMessage);
          expect(loggedData.error.stack).toBeDefined();
          expect(loggedData.error.name).toBe('Error');
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should log additional context with errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
        fc.record({
          groupId: fc.integer({ min: 1, max: 1000 }),
          operation: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0)
        }),
        async (errorMessage, additionalContext) => {
          consoleErrorSpy.mockClear();
          const error = new Error(errorMessage);

          logger.error('test-context', error, additionalContext);

          // Verify: Additional context is logged
          expect(consoleErrorSpy).toHaveBeenCalled();
          
          // The additional context should be in the second argument
          const errorCalls = consoleErrorSpy.mock.calls;
          expect(errorCalls.length).toBeGreaterThan(0);
          
          const loggedData = errorCalls[0][1];
          expect(loggedData).toBeDefined();
          expect(loggedData.context).toBeDefined();
          expect(loggedData.context.groupId).toBe(additionalContext.groupId);
          expect(loggedData.context.operation).toBe(additionalContext.operation);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should include stack traces in error logs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        async (context, errorMessage) => {
          consoleErrorSpy.mockClear();
          const error = new Error(errorMessage);

          logger.error(context, error);

          // Verify: Stack trace is included
          expect(consoleErrorSpy).toHaveBeenCalled();
          
          const errorCalls = consoleErrorSpy.mock.calls;
          expect(errorCalls.length).toBeGreaterThan(0);
          
          const loggedData = errorCalls[0][1];
          expect(loggedData).toBeDefined();
          expect(loggedData.error).toBeDefined();
          expect(loggedData.error.stack).toBeDefined();
          expect(typeof loggedData.error.stack).toBe('string');
          expect(loggedData.error.stack.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should log non-Error objects as-is', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer(),
          fc.record({
            code: fc.string({ minLength: 1, maxLength: 20 }),
            details: fc.string({ minLength: 1, maxLength: 50 })
          })
        ),
        async (context, errorValue) => {
          consoleErrorSpy.mockClear();

          logger.error(context, errorValue);

          // Verify: Non-Error objects are logged as-is
          expect(consoleErrorSpy).toHaveBeenCalled();
          
          const errorCalls = consoleErrorSpy.mock.calls;
          expect(errorCalls.length).toBeGreaterThan(0);
          
          const loggedData = errorCalls[0][1];
          expect(loggedData).toBeDefined();
          expect(loggedData.error).toEqual(errorValue);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should log all error components together', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
        fc.record({
          operationName: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
          attemptNumber: fc.integer({ min: 1, max: 10 }),
          groupId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined })
        }),
        async (context, errorMessage, additionalContext) => {
          consoleErrorSpy.mockClear();
          const error = new Error(errorMessage);

          logger.error(context, error, additionalContext);

          // Verify: All components are present
          expect(consoleErrorSpy).toHaveBeenCalled();
          
          const errorCalls = consoleErrorSpy.mock.calls;
          expect(errorCalls.length).toBeGreaterThan(0);
          
          // Check first argument (log message with context)
          const logMessage = errorCalls[0][0];
          expect(logMessage).toContain('[ERROR]');
          expect(logMessage).toContain(context);
          
          // Check second argument (error details and context)
          const loggedData = errorCalls[0][1];
          expect(loggedData).toBeDefined();
          
          // Verify error details
          expect(loggedData.error).toBeDefined();
          expect(loggedData.error.message).toBe(errorMessage);
          expect(loggedData.error.stack).toBeDefined();
          expect(loggedData.error.name).toBe('Error');
          
          // Verify additional context
          expect(loggedData.context).toBeDefined();
          expect(loggedData.context.operationName).toBe(additionalContext.operationName);
          expect(loggedData.context.attemptNumber).toBe(additionalContext.attemptNumber);
          if (additionalContext.groupId !== undefined) {
            expect(loggedData.context.groupId).toBe(additionalContext.groupId);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
