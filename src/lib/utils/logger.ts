export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  operation: string;
  details: any;
  error?: Error;
}

export class Logger {
  private static instance: Logger;
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 1000;

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private addEntry(level: LogLevel, operation: string, details: any, error?: Error) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      operation,
      details,
      error
    };

    console.log(`[${level}] ${operation}:`, details, error || '');
    
    this.logs.unshift(entry);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.pop();
    }

    // For errors, also report to extension's error tracking
    if (level === LogLevel.ERROR) {
      chrome.runtime.sendMessage({
        type: 'SYNC_ERROR',
        payload: {
          operation,
          details,
          error: error?.message || 'Unknown error',
          stack: error?.stack
        }
      }).catch(() => {
        // Ignore message sending errors
      });
    }
  }

  debug(operation: string, details: any) {
    this.addEntry(LogLevel.DEBUG, operation, details);
  }

  info(operation: string, details: any) {
    this.addEntry(LogLevel.INFO, operation, details);
  }

  warn(operation: string, details: any) {
    this.addEntry(LogLevel.WARN, operation, details);
  }

  error(operation: string, details: any, error?: Error) {
    this.addEntry(LogLevel.ERROR, operation, details, error);
  }

  getRecentLogs(count: number = 100): LogEntry[] {
    return this.logs.slice(0, count);
  }

  getLogsByLevel(level: LogLevel, count: number = 100): LogEntry[] {
    return this.logs.filter(log => log.level === level).slice(0, count);
  }

  getLogsByOperation(operation: string, count: number = 100): LogEntry[] {
    return this.logs.filter(log => log.operation.includes(operation)).slice(0, count);
  }

  clearLogs() {
    this.logs = [];
  }

  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// Retry mechanism
export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffFactor?: number;
}

const defaultRetryOptions: Required<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2
};

export async function withRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const logger = Logger.getInstance();
  const opts = { ...defaultRetryOptions, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      logger.debug(operation, { attempt, status: 'starting' });
      const result = await fn();
      logger.debug(operation, { attempt, status: 'success' });
      return result;
    } catch (error) {
      lastError = error as Error;
      logger.warn(operation, { 
        attempt, 
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (attempt === opts.maxAttempts) {
        break;
      }

      const delay = opts.delayMs * Math.pow(opts.backoffFactor, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  if (lastError) {
    logger.error(operation, { 
      attempts: opts.maxAttempts,
      status: 'exhausted'
    }, lastError);
    
    throw lastError;
  }

  // This should never happen since we always set lastError in catch
  throw new Error(`${operation} failed after ${opts.maxAttempts} attempts`);
}

// Operation tracking
export interface OperationTimer {
  start: number;
  operation: string;
}

export class OperationTracker {
  private static instance: OperationTracker;
  private activeOperations = new Map<string, OperationTimer>();
  private logger = Logger.getInstance();

  private constructor() {}

  static getInstance(): OperationTracker {
    if (!OperationTracker.instance) {
      OperationTracker.instance = new OperationTracker();
    }
    return OperationTracker.instance;
  }

  startOperation(operation: string, details: any = {}): string {
    const id = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.activeOperations.set(id, {
      start: Date.now(),
      operation
    });
    
    this.logger.debug(`${operation}:start`, { 
      operationId: id,
      ...details
    });

    return id;
  }

  endOperation(operationId: string, details: any = {}) {
    const timer = this.activeOperations.get(operationId);
    if (timer) {
      const duration = Date.now() - timer.start;
      this.activeOperations.delete(operationId);
      
      this.logger.info(`${timer.operation}:end`, {
        operationId,
        durationMs: duration,
        ...details
      });
    }
  }

  getActiveOperations(): Array<{ id: string; operation: string; durationMs: number }> {
    const now = Date.now();
    return Array.from(this.activeOperations.entries()).map(([id, timer]) => ({
      id,
      operation: timer.operation,
      durationMs: now - timer.start
    }));
  }
}
