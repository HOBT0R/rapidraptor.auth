// Core API client
export { createApiClient } from './core/apiClient.js';
export type { ApiClient } from './core/apiClient.js';
export { TokenManager } from './core/tokenManager.js';
export { ErrorHandler } from './core/errorHandler.js';
export { RequestQueue } from './core/requestQueue.js';

// Re-export shared types
export type {
  SessionInfo,
  ErrorResponse,
  ErrorCode,
  ApiClientConfig,
} from '@rapidraptor/auth-shared';

export { ERROR_CODES, DEFAULTS } from '@rapidraptor/auth-shared';




