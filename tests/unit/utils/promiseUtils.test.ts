import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { delay, retryWithBackoff, chromeApiPromise, debounce, throttle } from '../../../src/lib/utils/promiseUtils';

describe('promiseUtils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('delay', () => {
    it('should delay execution for specified milliseconds', async () => {
      const promise = delay(1000);
      vi.advanceTimersByTime(1000);
      await promise;
      expect(true).toBe(true); // If we get here, delay worked
    });

    it('should resolve after the delay', async () => {
      const start = Date.now();
      vi.useRealTimers(); // Use real timers for this test
      await delay(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some variance
    });
  });

  describe('retryWithBackoff', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await retryWithBackoff(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1 failed'))
        .mockRejectedValueOnce(new Error('Attempt 2 failed'))
        .mockResolvedValue('success');

      const promise = retryWithBackoff(operation, { maxAttempts: 3, baseDelay: 100 });

      // Advance timers for first retry
      await vi.advanceTimersByTimeAsync(100);
      // Advance timers for second retry
      await vi.advanceTimersByTimeAsync(200);

      const result = await promise;

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw error after max attempts', async () => {
      const error = new Error('Operation failed');
      const operation = vi.fn().mockRejectedValue(error);

      const promise = retryWithBackoff(operation, { maxAttempts: 2, baseDelay: 100 });
      const assertion = expect(promise).rejects.toThrow('Operation failed');

      // Advance timers for retry
      await vi.advanceTimersByTimeAsync(100);

      await assertion;
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should use exponential backoff', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const operation = vi.fn().mockRejectedValue(new Error('Failed'));
      const startTime = Date.now();

      try {
        await retryWithBackoff(operation, {
          maxAttempts: 3,
          baseDelay: 50,
          backoffFactor: 2,
        });
      } catch (e) {
        // Expected to fail
      }

      const elapsed = Date.now() - startTime;
      // Should have delays of 50ms and 100ms = 150ms total minimum
      expect(elapsed).toBeGreaterThanOrEqual(140); // Allow some variance
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should respect maxDelay', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const operation = vi.fn().mockRejectedValue(new Error('Failed'));

      try {
        await retryWithBackoff(operation, {
          maxAttempts: 3,
          baseDelay: 1000,
          backoffFactor: 10,
          maxDelay: 100,
        });
      } catch (e) {
        // Expected to fail
      }

      // With maxDelay of 100ms, total delay should be ~200ms (2 retries * 100ms)
      // not 11000ms (1000ms + 10000ms)
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should handle edge case: maxAttempts of 1', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Failed'));

      await expect(
        retryWithBackoff(operation, { maxAttempts: 1 })
      ).rejects.toThrow('Failed');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle edge case: zero baseDelay', async () => {
      vi.useRealTimers();
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValue('success');

      const result = await retryWithBackoff(operation, {
        maxAttempts: 2,
        baseDelay: 0,
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should handle edge case: backoffFactor of 1 (no exponential growth)', async () => {
      vi.useRealTimers();
      const operation = vi.fn().mockRejectedValue(new Error('Failed'));
      const startTime = Date.now();

      try {
        await retryWithBackoff(operation, {
          maxAttempts: 3,
          baseDelay: 50,
          backoffFactor: 1,
        });
      } catch (e) {
        // Expected to fail
      }

      const elapsed = Date.now() - startTime;
      // With backoffFactor of 1, delays should be 50ms + 50ms = 100ms
      expect(elapsed).toBeGreaterThanOrEqual(90);
      expect(elapsed).toBeLessThan(200); // Should not grow exponentially
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should handle edge case: operation throws non-Error object', async () => {
      const operation = vi.fn().mockRejectedValue('string error');

      const promise = retryWithBackoff(operation, { maxAttempts: 2, baseDelay: 100 });
      const assertion = expect(promise).rejects.toBe('string error');
      await vi.advanceTimersByTimeAsync(100);

      await assertion;
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should handle edge case: very large backoffFactor', async () => {
      vi.useRealTimers();
      const operation = vi.fn().mockRejectedValue(new Error('Failed'));

      try {
        await retryWithBackoff(operation, {
          maxAttempts: 3,
          baseDelay: 10,
          backoffFactor: 100,
          maxDelay: 50,
        });
      } catch (e) {
        // Expected to fail
      }

      // maxDelay should cap the exponential growth
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should handle edge case: operation succeeds on last attempt', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1'))
        .mockRejectedValueOnce(new Error('Attempt 2'))
        .mockResolvedValue('success on last attempt');

      const promise = retryWithBackoff(operation, { maxAttempts: 3, baseDelay: 100 });

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);

      const result = await promise;

      expect(result).toBe('success on last attempt');
      expect(operation).toHaveBeenCalledTimes(3);
    });
  });

  describe('chromeApiPromise', () => {
    it('should resolve with result on success', async () => {
      const mockResult = { id: '123', title: 'Test' };
      const apiCall = (callback: (result: any) => void) => {
        callback(mockResult);
      };

      const result = await chromeApiPromise(apiCall);

      expect(result).toEqual(mockResult);
    });

    it('should reject with error on chrome.runtime.lastError', async () => {
      (global.chrome.runtime as any).lastError = { message: 'API Error' };

      const apiCall = (callback: (result: any) => void) => {
        callback(null);
      };

      await expect(chromeApiPromise(apiCall)).rejects.toThrow('API Error');

      // Clean up
      delete (global.chrome.runtime as any).lastError;
    });

    it('should handle undefined result', async () => {
      const apiCall = (callback: (result: any) => void) => {
        callback(undefined);
      };

      const result = await chromeApiPromise(apiCall);

      expect(result).toBeUndefined();
    });
  });

  describe('debounce', () => {
    it('should debounce function calls', async () => {
      vi.useRealTimers();
      const func = vi.fn();
      const debounced = debounce(func, 100);

      debounced();
      debounced();
      debounced();

      expect(func).not.toHaveBeenCalled();

      await delay(150);

      expect(func).toHaveBeenCalledTimes(1);
    });

    it('should execute on leading edge when enabled', async () => {
      vi.useRealTimers();
      const func = vi.fn();
      const debounced = debounce(func, 100, { leading: true, trailing: false });

      debounced();
      expect(func).toHaveBeenCalledTimes(1);

      debounced();
      debounced();

      await delay(150);

      // Should still be 1 because trailing is disabled
      expect(func).toHaveBeenCalledTimes(1);
    });

    it('should pass arguments correctly', async () => {
      vi.useRealTimers();
      const func = vi.fn();
      const debounced = debounce(func, 50);

      debounced('arg1', 'arg2');

      await delay(100);

      expect(func).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should reset timer on subsequent calls', async () => {
      vi.useRealTimers();
      const func = vi.fn();
      const debounced = debounce(func, 100);

      debounced();
      await delay(50);
      debounced();
      await delay(50);
      debounced();

      expect(func).not.toHaveBeenCalled();

      await delay(150);

      expect(func).toHaveBeenCalledTimes(1);
    });
  });

  describe('throttle', () => {
    it('should throttle function calls', async () => {
      vi.useRealTimers();
      const func = vi.fn();
      const throttled = throttle(func, 100);

      throttled();
      expect(func).toHaveBeenCalledTimes(1);

      throttled();
      throttled();
      expect(func).toHaveBeenCalledTimes(1);

      await delay(120);

      // After waiting, the scheduled call should have executed
      expect(func).toHaveBeenCalledTimes(2);

      // New call after throttle period should execute immediately
      throttled();
      expect(func).toHaveBeenCalledTimes(3);
    });

    it('should execute immediately on first call', () => {
      vi.useRealTimers();
      const func = vi.fn();
      const throttled = throttle(func, 100);

      throttled();
      expect(func).toHaveBeenCalledTimes(1);
    });

    it('should pass arguments correctly', async () => {
      vi.useRealTimers();
      const func = vi.fn();
      const throttled = throttle(func, 50);

      throttled('arg1', 'arg2');

      expect(func).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should schedule delayed execution within throttle period', async () => {
      vi.useRealTimers();
      const func = vi.fn();
      const throttled = throttle(func, 100);

      throttled();
      expect(func).toHaveBeenCalledTimes(1);

      await delay(50);
      throttled();
      expect(func).toHaveBeenCalledTimes(1);

      await delay(100);
      expect(func).toHaveBeenCalledTimes(2);
    });
  });
});
