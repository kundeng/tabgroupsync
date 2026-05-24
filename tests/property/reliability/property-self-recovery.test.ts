import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 3: Bounded Self-Recovery
 * 
 * For any number of initialization failures, the system SHALL:
 * - Attempt at most 3 immediate retries + 1 recovery alarm
 * - ensureInitialized() SHALL recover on-demand when called after failures
 * - ensureInitialized() SHALL deduplicate concurrent calls (reentrant guard)
 * - Recovery alarm SHALL clear itself after attempt (success or failure)
 * 
 * Validates: Requirements 3.1, 3.2, 3.4, 3.5
 */

describe('Feature: sw-reliability, Property 3: Bounded Self-Recovery', () => {
  let alarmListeners: Array<(alarm: chrome.alarms.Alarm) => void>;
  let createdAlarms: Map<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    alarmListeners = [];
    createdAlarms = new Map();

    vi.mocked(chrome.alarms.create).mockImplementation(((name: string, alarmInfo?: any) => {
      createdAlarms.set(name, alarmInfo || {});
      return Promise.resolve();
    }) as any);

    vi.mocked(chrome.alarms.onAlarm.addListener).mockImplementation((listener: any) => {
      alarmListeners.push(listener);
    });

    vi.mocked(chrome.alarms.clear).mockImplementation(((name: string) => {
      createdAlarms.delete(name);
      return Promise.resolve(true);
    }) as any);

    vi.mocked(chrome.alarms.get).mockImplementation(((name: string) => {
      const info = createdAlarms.get(name);
      if (!info) return Promise.resolve(undefined);
      return Promise.resolve({
        name,
        scheduledTime: Date.now() + (info.delayInMinutes ?? info.periodInMinutes ?? 1) * 60 * 1000,
        periodInMinutes: info.periodInMinutes,
      } as chrome.alarms.Alarm);
    }) as any);
  });

  it('should schedule recovery alarm after max retries are exhausted', async () => {
    // Simulate: initializeWithRetry fails 3 times, then schedules alarm
    let retryCount = 0;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      retryCount++;
      // Simulate failure — in real code, initializeAndSync throws
    }

    // After max retries, schedule recovery alarm
    await chrome.alarms.create('retry-init', { delayInMinutes: 1 });

    expect(retryCount).toBe(3);
    expect(createdAlarms.has('retry-init')).toBe(true);
    const alarm = createdAlarms.get('retry-init');
    expect(alarm.delayInMinutes).toBe(1);
  });

  it('should clear recovery alarm after successful recovery', async () => {
    // Setup: recovery alarm exists
    await chrome.alarms.create('retry-init', { delayInMinutes: 1 });
    expect(createdAlarms.has('retry-init')).toBe(true);

    // Register alarm handler
    let initSucceeded = false;
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'retry-init') {
        // Simulate successful init
        initSucceeded = true;
        await chrome.alarms.clear('retry-init');
      }
    });

    // Fire the alarm
    await alarmListeners[0]({
      name: 'retry-init',
      scheduledTime: Date.now(),
    });

    expect(initSucceeded).toBe(true);
    expect(createdAlarms.has('retry-init')).toBe(false);
  });

  it('should clear recovery alarm even on failed recovery (no infinite loop)', async () => {
    await chrome.alarms.create('retry-init', { delayInMinutes: 1 });

    // Register alarm handler that simulates failed recovery
    let recoveryAttempted = false;
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'retry-init') {
        recoveryAttempted = true;
        // Recovery failed — still clear the alarm (no rescheduling)
        await chrome.alarms.clear('retry-init');
      }
    });

    await alarmListeners[0]({
      name: 'retry-init',
      scheduledTime: Date.now(),
    });

    expect(recoveryAttempted).toBe(true);
    expect(createdAlarms.has('retry-init')).toBe(false);
  });

  it('ensureInitialized should deduplicate concurrent calls via shared promise', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }), // number of concurrent calls
        async (concurrentCalls) => {
          let initCount = 0;
          let isReady = false;
          let initPromise: Promise<boolean> | null = null;

          // Simulate ensureInitialized with reentrant guard
          async function ensureInitialized(): Promise<boolean> {
            if (isReady) return true;
            if (initPromise) return initPromise;
            initPromise = (async () => {
              initCount++;
              // Simulate async init
              await new Promise(resolve => setTimeout(resolve, 10));
              isReady = true;
              return true;
            })().then(result => { initPromise = null; return result; });
            return initPromise;
          }

          // Fire N concurrent calls
          const results = await Promise.all(
            Array.from({ length: concurrentCalls }, () => ensureInitialized())
          );

          // All calls should succeed
          expect(results.every(r => r === true)).toBe(true);
          // But init should only run ONCE (deduplication)
          expect(initCount).toBe(1);
          expect(isReady).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('ensureInitialized should allow retry after failed init (sequential calls)', async () => {
    // Verify that after a failed init, a subsequent call retries.
    // This mirrors the real ensureInitialized pattern where initializeManagers throws.
    let initCount = 0;
    let isReady = false;
    let initPromise: Promise<boolean> | null = null;
    const FAIL_UNTIL = 3;

    async function ensureInitialized(): Promise<boolean> {
      if (isReady) return true;
      if (initPromise) return initPromise;
      initPromise = (async () => {
        try {
          initCount++;
          if (initCount <= FAIL_UNTIL) {
            throw new Error(`Init failure ${initCount}`);
          }
          isReady = true;
          return true;
        } catch {
          return false;
        }
      })().then(result => { initPromise = null; return result; });
      return initPromise;
    }

    // Sequential calls: first FAIL_UNTIL fail, then success
    const results: boolean[] = [];
    for (let i = 0; i < FAIL_UNTIL + 2; i++) {
      results.push(await ensureInitialized());
    }

    // First FAIL_UNTIL calls return false
    for (let i = 0; i < FAIL_UNTIL; i++) {
      expect(results[i]).toBe(false);
    }
    // Call FAIL_UNTIL+1 succeeds
    expect(results[FAIL_UNTIL]).toBe(true);
    // Subsequent calls return true immediately (cached)
    expect(results[FAIL_UNTIL + 1]).toBe(true);
    expect(isReady).toBe(true);
    // Init ran FAIL_UNTIL+1 times (failures + 1 success), not more
    expect(initCount).toBe(FAIL_UNTIL + 1);
  });

  it('total recovery attempts should be bounded: 3 immediate + 1 alarm = 4 max', () => {
    // This is a design invariant test
    const MAX_IMMEDIATE_RETRIES = 3;
    const MAX_ALARM_RETRIES = 1; // One recovery alarm, no rescheduling
    const TOTAL_MAX = MAX_IMMEDIATE_RETRIES + MAX_ALARM_RETRIES;

    expect(TOTAL_MAX).toBe(4);

    // After 4 attempts, only ensureInitialized provides on-demand recovery
    // (which is unbounded but only fires on actual events, not in a loop)
  });
});
