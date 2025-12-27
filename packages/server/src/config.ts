import type { Firestore } from 'firebase-admin/firestore';
import { SessionCache } from './session/sessionCache.js';
import { FirestoreSync } from './session/firestoreSync.js';
import { SessionService } from './session/sessionService.js';
import type { SessionServiceConfig } from '@rapidraptor/auth-shared';
import { DEFAULTS } from '@rapidraptor/auth-shared';

/**
 * Create a configured SessionService instance
 * This helper function makes it easy to set up session management with environment-specific configuration
 *
 * @param firestore - Firestore instance
 * @param config - Optional configuration to override defaults
 * @returns Configured SessionService instance
 *
 * @example
 * // Use defaults
 * const sessionService = createSessionService(firestore);
 *
 * @example
 * // Override for development environment
 * const sessionService = createSessionService(firestore, {
 *   inactivityTimeoutMs: 1 * 60 * 60 * 1000, // 1 hour for dev
 *   firestoreWriteThrottleMs: 1 * 60 * 1000, // 1 minute for dev
 *   firestoreCollectionName: 'dev_user_sessions'
 * });
 *
 * @example
 * // Override for production environment
 * const sessionService = createSessionService(firestore, {
 *   inactivityTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
 *   firestoreWriteThrottleMs: 5 * 60 * 1000, // 5 minutes
 *   firestoreCollectionName: 'user_sessions'
 * });
 */
export function createSessionService(
  firestore: Firestore,
  config?: Partial<SessionServiceConfig>,
): SessionService {
  const inactivityTimeout     = config?.inactivityTimeoutMs ?? DEFAULTS.INACTIVITY_TIMEOUT_MS;
  const throttleMs            = config?.firestoreWriteThrottleMs ?? DEFAULTS.FIRESTORE_WRITE_THROTTLE_MS;
  const usersCollectionName   = config?.firestoreCollectionName ?? DEFAULTS.FIRESTORE_SESSIONS_COLLECTION_NAME;
  const logoutsCollectionName = config?.firestoreLogoutsCollectionName ?? DEFAULTS.FIRESTORE_LOGOUTS_COLLECTION_NAME;
  const logoutTtlMs           = config?.logoutTtlMs ?? DEFAULTS.LOGOUT_TTL_MS;
  const cache                 = new SessionCache(inactivityTimeout);
  const firestoreSync         = new FirestoreSync(firestore, throttleMs, usersCollectionName);
  const sessionService        = new SessionService(
    cache,
    firestoreSync,
    firestore,
    inactivityTimeout,
    usersCollectionName,
    logoutsCollectionName,
    logoutTtlMs,
  );

  return sessionService;
}

