import { vi } from 'vitest';

// Mock Chrome APIs
global.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  storage: {
    sync: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
      remove: vi.fn(),
    },
    local: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
    },
  },
  bookmarks: {
    create: vi.fn(),
    get: vi.fn(),
    getChildren: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    removeTree: vi.fn(),
    getTree: vi.fn(),
    search: vi.fn(),
  },
  tabGroups: {
    query: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
  },
  tabs: {
    query: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    group: vi.fn(),
  },
} as any;

// Mock Performance API
global.performance = {
  mark: vi.fn(),
  measure: vi.fn(),
  clearMarks: vi.fn(),
  clearMeasures: vi.fn(),
  getEntriesByName: vi.fn(),
  getEntriesByType: vi.fn(),
  now: vi.fn(() => Date.now()),
} as any;

// Mock console methods to avoid cluttering test output
global.console = {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};
