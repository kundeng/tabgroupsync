import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { Logger } from '../../../src/lib/utils/logger';
import { arbitraryOperationType, arbitraryOperationOutcome, arbitraryTargetType } from '../arbitraries';

/**
 * Property 27: Operation Logging Completeness
 * 
 * For any sync operation (create, update, delete, restore), the Logger should record
 * the operation type, target group/folder, outcome, and relevant metadata to the console
 * 
 * Validates: Requirements 11.1
 */

describe('Property 27: Operation Logging Completeness', () => {
  let logger: Logger;
  let consoleLogSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = Logger.getInstance();
    consoleLogSpy = vi.spyOn(console, 'log');
  });

  it('should log all operation details', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryOperationType,
        arbitraryTargetType,
        arbitraryOperationOutcome,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: 10000 }),
        async (opType, targetType, outcome, targetName, duration) => {
          // Log operation
          logger.logOperation(opType, {
            operation: opType,
            target: {
              type: targetType,
              name: targetName
            },
            outcome,
            duration
          });

          // Verify: Console.log was called
          expect(consoleLogSpy).toHaveBeenCalled();

          // Verify: Log contains operation type
          const logCalls = consoleLogSpy.mock.calls;
          const hasOperationType = logCalls.some(call => 
            JSON.stringify(call).includes(opType)
          );
          expect(hasOperationType).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should include target information in logs', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryOperationType,
        arbitraryTargetType,
        fc.string({ minLength: 1, maxLength: 50 }),
        async (opType, targetType, targetName) => {
          consoleLogSpy.mockClear();

          logger.logOperation(opType, {
            operation: opType,
            target: {
              type: targetType,
              name: targetName
            },
            outcome: 'success'
          });

          // Verify: Target information is logged
          expect(consoleLogSpy).toHaveBeenCalled();
          const logCalls = consoleLogSpy.mock.calls;
          const hasTargetInfo = logCalls.some(call =>
            JSON.stringify(call).includes(targetType)
          );
          expect(hasTargetInfo).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should log operation outcomes', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryOperationType,
        arbitraryOperationOutcome,
        async (opType, outcome) => {
          consoleLogSpy.mockClear();

          logger.logOperation(opType, {
            operation: opType,
            target: {
              type: 'group',
              name: 'Test Group'
            },
            outcome
          });

          // Verify: Outcome is logged
          expect(consoleLogSpy).toHaveBeenCalled();
          const logCalls = consoleLogSpy.mock.calls;
          const hasOutcome = logCalls.some(call =>
            JSON.stringify(call).includes(outcome)
          );
          expect(hasOutcome).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should log metadata when provided', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryOperationType,
        fc.record({
          tabCount: fc.integer({ min: 0, max: 100 }),
          bookmarkCount: fc.integer({ min: 0, max: 100 }),
          customField: fc.string({ minLength: 1, maxLength: 50 })
        }),
        async (opType, metadata) => {
          consoleLogSpy.mockClear();

          logger.logOperation(opType, {
            operation: opType,
            target: {
              type: 'group',
              name: 'Test Group'
            },
            outcome: 'success',
            metadata
          });

          // Verify: Metadata is logged
          expect(consoleLogSpy).toHaveBeenCalled();
          const logCalls = consoleLogSpy.mock.calls;
          const logString = JSON.stringify(logCalls);
          
          // Check that at least one metadata field is present
          const hasMetadata = logString.includes('tabCount') || 
                             logString.includes('bookmarkCount') ||
                             logString.includes('customField');
          expect(hasMetadata).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);

  it('should log all required fields together', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryOperationType,
        arbitraryTargetType,
        arbitraryOperationOutcome,
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
        fc.option(fc.integer({ min: 0, max: 10000 }), { nil: undefined }),
        async (opType, targetType, outcome, targetName, targetId, duration) => {
          consoleLogSpy.mockClear();

          logger.logOperation(opType, {
            operation: opType,
            target: {
              type: targetType,
              name: targetName,
              id: targetId
            },
            outcome,
            duration
          });

          // Verify: All required fields are present in the log
          expect(consoleLogSpy).toHaveBeenCalled();
          
          // Get the actual logged object (second argument to console.log)
          const logCalls = consoleLogSpy.mock.calls;
          expect(logCalls.length).toBeGreaterThan(0);
          
          // Find the call that contains our operation log
          const operationLog = logCalls.find(call => 
            call[0] && typeof call[0] === 'string' && call[0].includes('[OPERATION]')
          );
          
          expect(operationLog).toBeDefined();
          
          // Check the logged object (second parameter)
          const loggedData = operationLog![1];
          expect(loggedData).toBeDefined();
          expect(loggedData.target).toBeDefined();
          expect(loggedData.target.type).toBe(targetType);
          expect(loggedData.target.name).toBe(targetName);
          expect(loggedData.outcome).toBe(outcome);
          
          // Check that operation type is in the log message
          expect(operationLog![0]).toContain(opType);
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
