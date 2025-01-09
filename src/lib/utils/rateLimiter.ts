import { Logger } from './logger';

export class StorageSyncLimiter {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private lastOperation = 0;
  private operationCount = 0;
  private readonly logger = Logger.getInstance();
  
  // Chrome sync storage allows ~120 operations per minute
  private readonly MAX_OPERATIONS = 100; // Use 100 to be safe
  private readonly INTERVAL = 60000; // 1 minute in ms
  private readonly MIN_DELAY = 100; // Reduced delay since we're only handling storage.sync

  constructor() {}

  async enqueue(operation: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await operation();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    try {
      while (this.queue.length > 0) {
        const now = Date.now();
        
        // Reset counter if a minute has passed
        if (now - this.lastOperation >= this.INTERVAL) {
          this.operationCount = 0;
          this.lastOperation = now;
        }
        
        // If we've hit the limit, wait until the next interval
        if (this.operationCount >= this.MAX_OPERATIONS) {
          const waitTime = this.INTERVAL - (now - this.lastOperation);
          this.logger.info('rateLimiter:waiting', {
            queueLength: this.queue.length,
            waitTime,
            operationCount: this.operationCount
          });
          await new Promise(resolve => setTimeout(resolve, waitTime));
          this.operationCount = 0;
          this.lastOperation = Date.now();
        }
        
        // Ensure minimum delay between operations
        const timeSinceLastOp = now - this.lastOperation;
        if (timeSinceLastOp < this.MIN_DELAY) {
          await new Promise(resolve => setTimeout(resolve, this.MIN_DELAY - timeSinceLastOp));
        }
        
        const operation = this.queue.shift();
        if (operation) {
          try {
            await operation();
            this.operationCount++;
            this.lastOperation = Date.now();
          } catch (error) {
            this.logger.error('rateLimiter:operationFailed', {
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  // Helper method to batch multiple storage.sync operations into a single write
  static async batchSet(items: Record<string, any>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      chrome.storage.sync.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }
}
