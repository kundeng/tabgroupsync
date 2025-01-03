/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

interface ExtendableEvent extends Event {
  waitUntil(fn: Promise<any>): void;
}

interface ServiceWorkerGlobalScope extends WorkerGlobalScope {
  skipWaiting(): Promise<void>;
  clients: Clients;
  registration: ServiceWorkerRegistration;
  addEventListener(type: 'install', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: ExtendableMessageEvent) => void): void;
  addEventListener(type: 'push', listener: (event: PushEvent) => void): void;
  addEventListener(type: 'sync', listener: (event: SyncEvent) => void): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

interface DebugTools {
  getLogs: () => any[];
  getErrorLogs: () => any[];
  getSyncLogs: () => any[];
  clearLogs: () => void;
  exportLogs: () => string;
  syncEngine: any;
  storage: any;
}

declare global {
  interface ServiceWorkerGlobalScope {
    debugTools?: DebugTools;
  }
}

export {};
