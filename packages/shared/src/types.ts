import { ERROR_CODES } from './constants.js';

/**
 * Session information stored in Firestore and cache
 */
export interface SessionInfo {
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
}

/**
 * Session validation status
 * Used to avoid boolean blindness when checking session validity
 * Provides explicit information about why a session is invalid
 */
export enum SessionValidationStatus {
  VALID = 'VALID',
  NOT_FOUND = 'NOT_FOUND',
  EXPIRED = 'EXPIRED',
  DATA_INTEGRITY_ERROR = 'DATA_INTEGRITY_ERROR',
}

/**
 * Error codes returned by the authentication system
 * Type derived from ERROR_CODES in constants.ts (single source of truth)
 * This extracts the union of all values from the ERROR_CODES object
 */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Error response format from server
 */
export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    requiresLogout: boolean;
    sessionExpired: boolean;
    timestamp: string;
  };
}

/**
 * Minimal interface representing a Firebase User
 * Used to avoid firebase dependency in shared package
 */
export interface FirebaseUser {
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

/**
 * Minimal interface representing a Firebase Auth instance
 * Used to avoid firebase dependency in shared package
 */
export interface FirebaseAuth {
  currentUser: FirebaseUser | null;
}

/**
 * Configuration for API client
 */
export interface ApiClientConfig {
  baseURL: string;
  auth: FirebaseAuth; // Firebase Auth instance
  onLogout?: () => void | Promise<void>;
  maxRetries?: number;
  timeout?: number;
  logoutEndpoint?: string; // Default: '/auth/logout'
}

/**
 * Session service configuration
 */
export interface SessionServiceConfig {
  inactivityTimeoutMs: number;
  firestoreWriteThrottleMs: number;
  firestoreCollectionName?: string;
  firestoreLogoutsCollectionName?: string; // Default: 'user_logouts'
  logoutTtlMs?: number; // Default: 1 hour
}

/**
 * Minimal interface representing a Firestore Timestamp
 * Used to avoid firebase-admin dependency in shared package
 */
export interface FirestoreTimestamp {
  toDate(): Date;
}

/**
 * Firestore document structure for session
 */
export interface FirestoreSessionDocument {
  userId: string;
  createdAt: FirestoreTimestamp | Date; // Firestore Timestamp or Date (Date when writing, Timestamp when reading)
  lastActivityAt: FirestoreTimestamp | Date;
  expiresAt: FirestoreTimestamp | Date;
}

/**
 * Firestore document structure for logout records
 */
export interface FirestoreLogoutDocument {
  userId: string;
  loggedOutAt: FirestoreTimestamp | Date; // Firestore Timestamp or Date (Date when writing, Timestamp when reading)
  expiresAt: FirestoreTimestamp | Date;
}

