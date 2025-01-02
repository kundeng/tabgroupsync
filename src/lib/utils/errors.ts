// Error types for better error handling
export enum ErrorType {
  STORAGE = 'storage',
  SYNC = 'sync',
  BOOKMARK = 'bookmark',
  TAB = 'tab',
  VALIDATION = 'validation',
  UNKNOWN = 'unknown'
}

export class ExtensionError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ExtensionError';
  }

  static isExtensionError(error: unknown): error is ExtensionError {
    return error instanceof ExtensionError;
  }
}

// Storage specific errors
export class StorageError extends ExtensionError {
  constructor(message: string, details?: unknown) {
    super(ErrorType.STORAGE, message, details);
    this.name = 'StorageError';
  }
}

// Sync specific errors
export class SyncError extends ExtensionError {
  constructor(message: string, details?: unknown) {
    super(ErrorType.SYNC, message, details);
    this.name = 'SyncError';
  }
}

// Bookmark specific errors
export class BookmarkError extends ExtensionError {
  constructor(message: string, details?: unknown) {
    super(ErrorType.BOOKMARK, message, details);
    this.name = 'BookmarkError';
  }
}

// Tab specific errors
export class TabError extends ExtensionError {
  constructor(message: string, details?: unknown) {
    super(ErrorType.TAB, message, details);
    this.name = 'TabError';
  }
}

// Validation specific errors
export class ValidationError extends ExtensionError {
  constructor(message: string, details?: unknown) {
    super(ErrorType.VALIDATION, message, details);
    this.name = 'ValidationError';
  }
}

// Error handler type
export type ErrorHandler = (error: ExtensionError) => void;

// Global error handler
export class ErrorManager {
  private static handlers: Set<ErrorHandler> = new Set();

  static subscribe(handler: ErrorHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  static handle(error: unknown): void {
    const extensionError = this.normalizeError(error);
    this.handlers.forEach(handler => handler(extensionError));
  }

  private static normalizeError(error: unknown): ExtensionError {
    if (ExtensionError.isExtensionError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return new ExtensionError(
        ErrorType.UNKNOWN,
        error.message,
        { originalError: error }
      );
    }

    return new ExtensionError(
      ErrorType.UNKNOWN,
      'An unknown error occurred',
      { originalError: error }
    );
  }
}

// Utility to wrap async functions with error handling
export function withErrorHandling<T>(
  fn: () => Promise<T>,
  errorType: ErrorType = ErrorType.UNKNOWN
): Promise<T> {
  return fn().catch(error => {
    if (ExtensionError.isExtensionError(error)) {
      ErrorManager.handle(error);
    } else {
      ErrorManager.handle(new ExtensionError(errorType, error.message, error));
    }
    throw error;
  });
}

// Helper to create error messages
export function createErrorMessage(
  type: ErrorType,
  action: string,
  details?: string
): string {
  const baseMessage = `Failed to ${action}`;
  return details ? `${baseMessage}: ${details}` : baseMessage;
}
