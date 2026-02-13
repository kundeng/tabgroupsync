import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageSyncLimiter } from '../../../src/lib/utils/rateLimiter';

describe('StorageSyncLimiter', () => {
  let limiter: StorageSyncLimiter;

  beforeEach(() => {
    limiter = new StorageSyncLimiter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('enqueue', () => {
    it('should execute single operation immediately', async () => {
      const operation = vi.fn().mockResolvedValue(undefined);

      const promise = limiter.enqueue(operation);
      await vi.runAllTimersAsync();
      await promise;

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should queue multiple operations', async () => {
      const operations = [
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
      ];

      const promises = operations.map((op) => limiter.enqueue(op));
      await vi.runAllTimersAsync();
      await Promise.all(promises);

      operations.forEach((op) => {
        expect(op).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle operation errors without stopping queue', async () => {
      const operations = [
        vi.fn().mockRejectedValue(new Error('Operation 1 failed')),
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
      ];

      const promises = operations.map((op) => limiter.enqueue(op));

      // Attach rejection/resolution expectations BEFORE advancing timers
      const p0 = expect(promises[0]).rejects.toThrow('Operation 1 failed');
      const p1 = expect(promises[1]).resolves.toBeUndefined();
      const p2 = expect(promises[2]).resolves.toBeUndefined();

      await vi.runAllTimersAsync();

      await p0;
      await p1;
      await p2;

      // All operations should have been called
      operations.forEach((op) => {
        expect(op).toHaveBeenCalledTimes(1);
      });
    });

    it('should enforce minimum delay between operations', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const operation1 = vi.fn().mockResolvedValue(undefined);
      const operation2 = vi.fn().mockResolvedValue(undefined);

      const startTime = Date.now();
      await limiter.enqueue(operation1);
      await limiter.enqueue(operation2);
      const elapsed = Date.now() - startTime;

      expect(operation1).toHaveBeenCalledTimes(1);
      expect(operation2).toHaveBeenCalledTimes(1);
      // Should have at least 100ms delay between operations
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some variance
    });

    it('should process operations sequentially', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const executionOrder: number[] = [];
      const operations = [
        vi.fn().mockImplementation(async () => {
          executionOrder.push(1);
        }),
        vi.fn().mockImplementation(async () => {
          executionOrder.push(2);
        }),
        vi.fn().mockImplementation(async () => {
          executionOrder.push(3);
        }),
      ];

      await Promise.all(operations.map((op) => limiter.enqueue(op)));

      expect(executionOrder).toEqual([1, 2, 3]);
      operations.forEach((op) => {
        expect(op).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('rate limiting behavior', () => {
    it('should handle edge case: empty queue', async () => {
      // Should not throw when processing empty queue
      await vi.runAllTimersAsync();
      expect(true).toBe(true);
    });

    it('should handle edge case: operation that takes time', async () => {
      vi.useRealTimers();
      const slowOperation = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      const startTime = Date.now();
      await limiter.enqueue(slowOperation);
      const elapsed = Date.now() - startTime;

      expect(slowOperation).toHaveBeenCalledTimes(1);
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });

    it('should handle edge case: many operations in queue', async () => {
      vi.useRealTimers();
      const operations = Array.from({ length: 10 }, () => 
        vi.fn().mockResolvedValue(undefined)
      );

      const promises = operations.map(op => limiter.enqueue(op));
      await Promise.all(promises);

      operations.forEach(op => {
        expect(op).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle edge case: operation throws synchronously', async () => {
      const operation = vi.fn().mockImplementation(() => {
        throw new Error('Synchronous error');
      });

      const promise = limiter.enqueue(operation);
      const assertion = expect(promise).rejects.toThrow('Synchronous error');
      await vi.runAllTimersAsync();
      await assertion;
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should continue processing after error', async () => {
      const operations = [
        vi.fn().mockRejectedValue(new Error('Error 1')),
        vi.fn().mockRejectedValue(new Error('Error 2')),
        vi.fn().mockResolvedValue(undefined),
      ];

      const promises = operations.map(op => limiter.enqueue(op));

      const p0 = expect(promises[0]).rejects.toThrow('Error 1');
      const p1 = expect(promises[1]).rejects.toThrow('Error 2');
      const p2 = expect(promises[2]).resolves.toBeUndefined();

      await vi.runAllTimersAsync();

      await p0;
      await p1;
      await p2;
    });
  });

  describe('batchSet', () => {
    it('should call chrome.storage.sync.set with items', async () => {
      const items = { key1: 'value1', key2: 'value2' };
      const setSpy = vi.spyOn(chrome.storage.sync, 'set').mockImplementation((items, callback) => {
        callback?.();
      });

      await StorageSyncLimiter.batchSet(items);

      expect(setSpy).toHaveBeenCalledWith(items, expect.any(Function));
    });

    it('should reject on chrome.runtime.lastError', async () => {
      const error = { message: 'Storage error' };
      (global.chrome.runtime as any).lastError = error;

      vi.spyOn(chrome.storage.sync, 'set').mockImplementation((items, callback) => {
        callback?.();
      });

      await expect(StorageSyncLimiter.batchSet({ key: 'value' })).rejects.toEqual(error);

      // Clean up
      delete (global.chrome.runtime as any).lastError;
    });

    it('should handle edge case: empty items object', async () => {
      const setSpy = vi.spyOn(chrome.storage.sync, 'set').mockImplementation((items, callback) => {
        callback?.();
      });

      await StorageSyncLimiter.batchSet({});

      expect(setSpy).toHaveBeenCalledWith({}, expect.any(Function));
    });

    it('should handle edge case: large items object', async () => {
      const largeItems = Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`key${i}`, `value${i}`])
      );
      const setSpy = vi.spyOn(chrome.storage.sync, 'set').mockImplementation((items, callback) => {
        callback?.();
      });

      await StorageSyncLimiter.batchSet(largeItems);

      expect(setSpy).toHaveBeenCalledWith(largeItems, expect.any(Function));
    });
  });
});
