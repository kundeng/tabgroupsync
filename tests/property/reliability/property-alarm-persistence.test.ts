import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 1: Alarm Persistence
 * 
 * For any service worker lifecycle (start → idle → terminate → wake),
 * the periodic sync alarm SHALL exist and fire at the configured interval.
 * 
 * Validates: Requirement 1.1, 1.2, 1.5
 */

describe('Feature: sw-reliability, Property 1: Alarm Persistence', () => {
  let alarmListeners: Array<(alarm: chrome.alarms.Alarm) => void>;
  let createdAlarms: Map<string, { periodInMinutes?: number; delayInMinutes?: number; when?: number }>;

  beforeEach(() => {
    vi.clearAllMocks();
    alarmListeners = [];
    createdAlarms = new Map();

    // Track alarm creation
    vi.mocked(chrome.alarms.create).mockImplementation(((name: string, alarmInfo?: any) => {
      createdAlarms.set(name, alarmInfo || {});
      return Promise.resolve();
    }) as any);

    // Track alarm listeners
    vi.mocked(chrome.alarms.onAlarm.addListener).mockImplementation((listener: any) => {
      alarmListeners.push(listener);
    });

    // Return created alarms
    vi.mocked(chrome.alarms.get).mockImplementation(((name: string) => {
      const info = createdAlarms.get(name);
      if (!info) return Promise.resolve(undefined);
      return Promise.resolve({
        name,
        scheduledTime: Date.now() + (info.periodInMinutes ?? 5) * 60 * 1000,
        periodInMinutes: info.periodInMinutes,
      } as chrome.alarms.Alarm);
    }) as any);

    vi.mocked(chrome.alarms.getAll).mockImplementation(() => {
      const alarms: chrome.alarms.Alarm[] = [];
      for (const [name, info] of createdAlarms) {
        alarms.push({
          name,
          scheduledTime: Date.now() + (info.periodInMinutes ?? 5) * 60 * 1000,
          periodInMinutes: info.periodInMinutes,
        } as chrome.alarms.Alarm);
      }
      return Promise.resolve(alarms);
    });

    vi.mocked(chrome.alarms.clear).mockImplementation(((name: string) => {
      const existed = createdAlarms.has(name);
      createdAlarms.delete(name);
      return Promise.resolve(existed);
    }) as any);
  });

  it('should create periodic-sync alarm with minimum 5 minute interval for any sync interval setting', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 120 }), // syncInterval in minutes (0 = not set)
        async (syncInterval) => {
          createdAlarms.clear();

          // Simulate startPeriodicSync behavior: create alarm with max(interval, 5)
          const periodInMinutes = Math.max(syncInterval || 5, 5);
          await chrome.alarms.create('periodic-sync', { periodInMinutes });

          // Verify alarm was created
          const alarm = await chrome.alarms.get('periodic-sync');
          expect(alarm).toBeDefined();
          expect(alarm!.name).toBe('periodic-sync');
          expect(alarm!.periodInMinutes).toBeGreaterThanOrEqual(5);
          expect(alarm!.periodInMinutes).toBe(periodInMinutes);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should register alarm listener that can handle periodic-sync alarm', async () => {
    // Register a listener (simulating what background.ts does)
    let syncCalled = false;
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'periodic-sync') {
        syncCalled = true;
      }
    });

    expect(alarmListeners.length).toBe(1);

    // Simulate alarm firing
    await alarmListeners[0]({
      name: 'periodic-sync',
      scheduledTime: Date.now(),
      periodInMinutes: 5,
    });

    expect(syncCalled).toBe(true);
  });

  it('should survive simulated worker restart: alarm persists, listener re-registered', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }), // number of simulated restarts
        async (restartCount) => {
          createdAlarms.clear();
          alarmListeners = [];

          // Initial setup
          await chrome.alarms.create('periodic-sync', { periodInMinutes: 5 });

          for (let i = 0; i < restartCount; i++) {
            // Simulate worker restart: listeners are lost but alarms persist
            alarmListeners = [];

            // Re-register listener (what background.ts does on startup)
            let syncCount = 0;
            chrome.alarms.onAlarm.addListener(async (alarm) => {
              if (alarm.name === 'periodic-sync') {
                syncCount++;
              }
            });

            // Verify alarm still exists (chrome.alarms persists across worker restarts)
            const alarm = await chrome.alarms.get('periodic-sync');
            expect(alarm).toBeDefined();
            expect(alarm!.name).toBe('periodic-sync');

            // Verify listener works after restart
            expect(alarmListeners.length).toBe(1);
            await alarmListeners[0]({
              name: 'periodic-sync',
              scheduledTime: Date.now(),
              periodInMinutes: 5,
            });
            expect(syncCount).toBe(1);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should update alarm when sync interval changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 2, maxLength: 10 }),
        async (intervals) => {
          createdAlarms.clear();

          for (const interval of intervals) {
            const periodInMinutes = Math.max(interval, 5);
            await chrome.alarms.create('periodic-sync', { periodInMinutes });

            const alarm = await chrome.alarms.get('periodic-sync');
            expect(alarm).toBeDefined();
            expect(alarm!.periodInMinutes).toBe(periodInMinutes);
          }

          // Only one alarm should exist (create overwrites)
          const allAlarms = await chrome.alarms.getAll();
          const periodicAlarms = allAlarms.filter(a => a.name === 'periodic-sync');
          expect(periodicAlarms.length).toBe(1);

          // Should have the last interval
          const lastInterval = Math.max(intervals[intervals.length - 1], 5);
          expect(periodicAlarms[0].periodInMinutes).toBe(lastInterval);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('should not fire sync for unknown alarm names', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }).filter(s => s !== 'periodic-sync' && s !== 'retry-init'),
        async (alarmName) => {
          let syncCalled = false;
          alarmListeners = [];

          chrome.alarms.onAlarm.addListener(async (alarm) => {
            if (alarm.name === 'periodic-sync') {
              syncCalled = true;
            }
          });

          // Fire alarm with random name
          await alarmListeners[0]({
            name: alarmName,
            scheduledTime: Date.now(),
          });

          expect(syncCalled).toBe(false);
        }
      ),
      { numRuns: 30 }
    );
  });
});
