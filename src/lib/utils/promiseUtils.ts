import { Logger } from './logger';

const logger = Logger.getInstance();

/**
 * Utility functions for handling Chrome API promises
 */
export function createChromePromise<T>(
  callback: (resolve: (value: T) => void) => void
): Promise<T> {
  return new Promise((resolve) => callback(resolve));
}

export function handleChromeError(): void {
  if (chrome.runtime.lastError) {
    console.error('Chrome API Error:', chrome.runtime.lastError);
  }
}

/**
 * Delay execution for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry options for exponential backoff
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
}

const defaultRetryOptions: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
};

/**
 * Retry an async operation with exponential backoff
 * @param operation - The async operation to retry
 * @param options - Retry configuration options
 * @returns The result of the operation
 * @throws The last error if all attempts fail
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...defaultRetryOptions, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      logger.debug('retryWithBackoff:attempt', { attempt, maxAttempts: opts.maxAttempts });
      const result = await operation();
      logger.debug('retryWithBackoff:success', { attempt });
      return result;
    } catch (error) {
      lastError = error as Error;
      logger.warn('retryWithBackoff:failed', {
        attempt,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (attempt === opts.maxAttempts) {
        break;
      }

      // Calculate delay with exponential backoff
      const delayMs = Math.min(
        opts.baseDelay * Math.pow(opts.backoffFactor, attempt - 1),
        opts.maxDelay
      );

      logger.debug('retryWithBackoff:waiting', { delayMs, nextAttempt: attempt + 1 });
      await delay(delayMs);
    }
  }

  logger.error('retryWithBackoff:exhausted', lastError!, {
    attempts: opts.maxAttempts,
  });

  throw lastError;
}

/**
 * Wrap a Chrome API callback-based function into a Promise
 * Handles chrome.runtime.lastError automatically
 */
export function chromeApiPromise<T>(
  apiCall: (callback: (result: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    apiCall((result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Debounce options
 */
export interface DebounceOptions {
  leading?: boolean; // Execute on the leading edge
  trailing?: boolean; // Execute on the trailing edge (default: true)
}

/**
 * Debounce a function to reduce overhead from rapid calls
 * Useful for debouncing sync operations when tab changes occur rapidly
 * @param func - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @param options - Debounce configuration options
 * @returns A debounced version of the function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  options: DebounceOptions = {}
): (...args: Parameters<T>) => void {
  const { leading = false, trailing = true } = options;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let lastCallTime = 0;

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    const execute = () => {
      lastCallTime = now;
      func.apply(this, args);
    };

    // Clear existing timeout
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    // Execute on leading edge if enabled and this is the first call or enough time has passed
    if (leading && (lastCallTime === 0 || timeSinceLastCall >= wait)) {
      execute();
      timeoutId = undefined;
    } else if (trailing) {
      // Schedule execution on trailing edge
      timeoutId = setTimeout(() => {
        execute();
        timeoutId = undefined;
      }, wait);
    }
  };
}

/**
 * Throttle a function to limit execution frequency
 * Similar to debounce but guarantees execution at regular intervals
 * @param func - The function to throttle
 * @param wait - The minimum time between executions in milliseconds
 * @returns A throttled version of the function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let lastCallTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    const execute = () => {
      lastCallTime = now;
      func.apply(this, args);
    };

    if (timeSinceLastCall >= wait) {
      // Enough time has passed, execute immediately
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      execute();
    } else if (timeoutId === undefined) {
      // Schedule execution for later
      timeoutId = setTimeout(() => {
        execute();
        timeoutId = undefined;
      }, wait - timeSinceLastCall);
    }
  };
}
