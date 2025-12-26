/**
 * Error codes
 * Type is derived from these constants in types.ts (single source of truth)
 */
export const ERROR_CODES = {
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  AUTH_FAILED: 'AUTH_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

/**
 * Default configuration values
 */
export const DEFAULTS = {
  /**
   * Default inactivity timeout: 24 hours in milliseconds
   */
  INACTIVITY_TIMEOUT_MS: 24 * 60 * 60 * 1000,

  /**
   * Default Firestore write throttle: 5 minutes in milliseconds
   */
  FIRESTORE_WRITE_THROTTLE_MS: 5 * 60 * 1000,

  /**
   * Default Firestore collection name for sessions
   */
  FIRESTORE_SESSIONS_COLLECTION_NAME: 'user_sessions',

  /**
   * Default Firestore collection name for logout records
   */
  FIRESTORE_LOGOUTS_COLLECTION_NAME: 'user_logouts',

  /**
   * Default logout record TTL: 1 hour in milliseconds
   * Matches typical JWT lifetime
   */
  LOGOUT_TTL_MS: 3600000,

  /**
   * Default max retries for token refresh
   */
  MAX_RETRIES: 1,

  /**
   * Default API timeout: 10 seconds
   */
  API_TIMEOUT_MS: 10 * 1000,
} as const;

