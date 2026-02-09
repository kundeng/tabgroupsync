/**
 * Operation details for structured logging
 */
export interface OperationDetails {
  operation: 'sync' | 'create' | 'update' | 'delete' | 'restore';
  target: {
    type: 'group' | 'folder' | 'bookmark' | 'snapshot';
    id?: string;
    name?: string;
  };
  outcome: 'success' | 'failure' | 'partial';
  duration?: number;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Retry an async operation with exponential backoff
 * Wrapper around retryWithBackoff for backward compatibility
 */
export async function withRetry<T>(
  operationName: string,
  operation: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number } = {}
): Promise<T> {
  const { retryWithBackoff } = await import('./promiseUtils');
  return retryWithBackoff(operation, {
    maxAttempts: options.maxAttempts || 3,
    baseDelay: options.delayMs || 1000,
  });
}

/**
 * Operation tracker for managing operation lifecycle and timing
 */
export class OperationTracker {
  private static instance: OperationTracker;
  private operations: Map<string, { name: string; context: any; startTime: number }> = new Map();
  private operationCounter = 0;

  private constructor() {}

  static getInstance(): OperationTracker {
    if (!OperationTracker.instance) {
      OperationTracker.instance = new OperationTracker();
    }
    return OperationTracker.instance;
  }

  startOperation(name: string, context?: any): string {
    const opId = `${name}-${this.operationCounter++}-${Date.now()}`;
    this.operations.set(opId, {
      name,
      context,
      startTime: Date.now(),
    });
    return opId;
  }

  endOperation(opId: string): void {
    const op = this.operations.get(opId);
    if (op) {
      const duration = Date.now() - op.startTime;
      this.operations.delete(opId);
      
      // Log operation completion
      Logger.getInstance().debug(`operation:completed:${op.name}`, {
        opId,
        duration,
        context: op.context,
      });
    }
  }
}

/**
 * Logger singleton class with structured logging and performance tracking
 * Integrates with Chrome DevTools Console and Performance API
 */
export class Logger {
  private static instance: Logger;

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Log a sync operation with structured details
   * Integrates with Performance API for timing analysis
   */
  logOperation(type: string, details: OperationDetails): void {
    const timestamp = new Date().toISOString();
    const operationId = `${type}-${Date.now()}`;

    // Console logging for operational visibility
    console.log(`[${timestamp}] [OPERATION] ${type}`, {
      target: details.target,
      outcome: details.outcome,
      duration: details.duration,
      metadata: details.metadata,
    });

    // Performance API for timing analysis
    if (details.duration !== undefined) {
      try {
        performance.mark(`${operationId}-start`);
        performance.mark(`${operationId}-end`);
        performance.measure(`operation:${type}`, `${operationId}-start`, `${operationId}-end`);
      } catch (e) {
        // Performance API may not be available in all contexts
      }
    }
  }

  /**
   * Log an error with full context and stack trace
   */
  error(context: string, error: Error | unknown, additionalContext?: Record<string, any>): void {
    const timestamp = new Date().toISOString();

    // Console error logging with full context
    console.error(`[${timestamp}] [ERROR] ${context}`, {
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : error,
      context: additionalContext,
    });
  }

  /**
   * Log a state change with before/after states
   */
  logStateChange(component: string, before: any, after: any, reason: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [STATE_CHANGE] ${component}`, {
      before,
      after,
      reason,
    });
  }

  /**
   * Log an automatic decision with reasoning
   */
  logDecision(decision: string, reasoning: string, context: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [DECISION] ${decision}`, {
      reasoning,
      context,
    });
  }

  /**
   * General info logging
   */
  info(message: string, context?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] ${message}`, context || {});
  }

  /**
   * General warning logging
   */
  warn(message: string, context?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [WARN] ${message}`, context || {});
  }

  /**
   * General debug logging
   */
  debug(message: string, context?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    console.debug(`[${timestamp}] [DEBUG] ${message}`, context || {});
  }

  /**
   * Start timing an operation using Performance API
   * Returns a mark name to be used with endTiming
   */
  startTiming(operationName: string): string {
    const markName = `${operationName}-${Date.now()}`;
    try {
      performance.mark(`${markName}-start`);
    } catch (e) {
      // Performance API may not be available in all contexts
    }
    return markName;
  }

  /**
   * End timing an operation and create a performance measure
   */
  endTiming(markName: string, operationName: string): void {
    try {
      performance.mark(`${markName}-end`);
      performance.measure(operationName, `${markName}-start`, `${markName}-end`);
    } catch (e) {
      // Performance API may not be available in all contexts
    }
  }
}
