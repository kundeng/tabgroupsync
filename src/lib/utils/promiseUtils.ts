// Utility functions for handling Chrome API promises
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