/**
 * Test Express Server with Authentication Middleware
 *
 * This module creates a complete Express server setup that demonstrates how to
 * integrate the @rapidraptor/auth library in a real application. It shows:
 *
 * 1. How to initialize Firebase Admin
 * 2. How to configure the token verifier
 * 3. How to set up the session service
 * 4. How to apply auth middleware to routes
 * 5. How to set up logout handler
 *
 * This server configuration mirrors what developers would implement in production,
 * but uses shorter timeouts for faster testing.
 *
 * @module __tests__/integration/test-server
 */

import express, { type Express, type Request, type Response } from 'express';
import {
  createAuthMiddleware,
  createLogoutHandler,
  SessionCache,
  FirestoreSync,
  SessionService,
} from '@rapidraptor/auth-server';
import {
  getEmulatorFirestore,
  initializeFirebaseEmulator,
} from './firebase-setup.js';
import { DEFAULTS } from '@rapidraptor/auth-shared';

// The @rapidraptor/auth-server package extends Express.Request with user property
// TypeScript should pick this up automatically, but if not, the type is:
// req.user?: { sub: string; email?: string; name?: string }

/**
 * Configuration for test server
 * Uses shorter timeouts than production for faster test execution
 */
const TEST_CONFIG = {
  // Session expires after 1 minute of inactivity (vs 24 hours in production)
  // This allows us to test expiration scenarios without waiting 24 hours
  inactivityTimeoutMs: 1 * 60 * 1000, // 1 minute

  // Firestore writes are throttled to every 1 second (vs 5 minutes in production)
  // This speeds up test execution significantly while still testing the throttling mechanism
  // In production, this would be 5 minutes (DEFAULTS.FIRESTORE_WRITE_THROTTLE_MS)
  firestoreWriteThrottleMs: 1 * 1000, // 1 second (much faster for tests)

  // Use test collection names to avoid conflicts with other tests
  firestoreCollectionName: 'test_user_sessions',
  firestoreLogoutsCollectionName: 'test_user_logouts',
};

/**
 * Production configuration example (commented for reference)
 *
 * In production, you would use:
 * ```typescript
 * const PRODUCTION_CONFIG = {
 *   inactivityTimeoutMs: DEFAULTS.INACTIVITY_TIMEOUT_MS, // 24 hours
 *   firestoreWriteThrottleMs: DEFAULTS.FIRESTORE_WRITE_THROTTLE_MS, // 5 minutes
 *   firestoreCollectionName: DEFAULTS.FIRESTORE_SESSIONS_COLLECTION_NAME, // 'user_sessions'
 *   firestoreLogoutsCollectionName: DEFAULTS.FIRESTORE_LOGOUTS_COLLECTION_NAME, // 'user_logouts'
 * };
 * ```
 */

/**
 * Create and configure Express server with authentication
 *
 * This function demonstrates the complete server setup pattern that developers
 * should follow in their applications:
 *
 * 1. Initialize Firebase Admin (for Firestore access)
 * 2. Create SessionService (manages user sessions)
 * 3. Create TokenVerifier (verifies JWT tokens)
 * 4. Create Auth Middleware (protects routes)
 * 5. Create Logout Handler (handles logout requests)
 * 6. Set up routes
 *
 * @returns {Promise<{ app: Express; firestoreSync: FirestoreSync }>} Configured Express server and FirestoreSync instance
 *
 * @example
 * ```typescript
 * // In your application's server setup
 * const { app, firestoreSync } = await createTestServer();
 *
 * // Or in production:
 * // const app = await createProductionServer();
 *
 * app.listen(3000, () => {
 *   console.log('Server running on port 3000');
 * });
 * ```
 */
export async function createTestServer(): Promise<{ app: Express; firestoreSync: FirestoreSync }> {
  // Step 1: Initialize Firebase Admin for emulator
  // In production, you would call initializeFirebaseAdmin() from @rapidraptor/auth-server
  // For emulator, we use the emulator-specific setup
  await initializeFirebaseEmulator();
  const firestore = getEmulatorFirestore();

  // Step 2: Create SessionService
  // This manages user sessions, tracking activity and expiration
  // The configuration uses short timeouts for testing, but the pattern
  // is the same as production
  //
  // For tests, we create the components manually so we can start the periodic sync
  // In production, you would use createSessionService() which handles this automatically
  const inactivityTimeout = TEST_CONFIG.inactivityTimeoutMs;
  const throttleMs = TEST_CONFIG.firestoreWriteThrottleMs;
  const cache = new SessionCache(inactivityTimeout);
  const firestoreSync = new FirestoreSync(
    firestore,
    throttleMs,
    TEST_CONFIG.firestoreCollectionName,
  );

  // Start periodic Firestore sync for throttled writes
  // This ensures queued writes are flushed periodically
  // In production, this would typically be started when the server starts
  firestoreSync.startPeriodicSync();

  const sessionService = new SessionService(
    cache,
    firestoreSync,
    firestore,
    inactivityTimeout,
    TEST_CONFIG.firestoreCollectionName,
    TEST_CONFIG.firestoreLogoutsCollectionName,
    DEFAULTS.LOGOUT_TTL_MS,
  );

  // Step 3: Create Token Verifier
  // This verifies JWT tokens from Firebase Auth
  //
  // IMPORTANT: For emulator testing, we use a custom verifier that decodes tokens
  // without full cryptographic verification because:
  // 1. The Firebase Auth emulator doesn't expose a JWKS endpoint
  // 2. Token verification is tested in unit tests (joseTokenVerifier.test.ts)
  // 3. Integration tests focus on session management flow, not token verification
  //
  // In production, you would use:
  // const tokenVerifier = new JoseTokenVerifier({
  //   jwksUri: 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  //   issuer: 'https://securetoken.google.com/YOUR_PROJECT_ID',
  //   audience: 'YOUR_PROJECT_ID',
  // });
  //
  // For emulator, we create a custom verifier that decodes the token
  // to extract user info without full signature verification
  const tokenVerifier: import('@rapidraptor/auth-server').UserTokenVerifier = {
    async verify(token: string): Promise<{ sub: string; email?: string; name?: string }> {
      // Decode token without verification (emulator mode)
      // In production, JoseTokenVerifier does full cryptographic verification
      const { decodeJwt } = await import('jose');
      const payload = decodeJwt(token);

      if (!payload.sub) {
        throw new Error('Token missing sub claim');
      }

      return {
        sub: payload.sub,
        email: payload.email as string | undefined,
        name: payload.name as string | undefined,
      };
    },
  };

  // Step 4: Create Auth Middleware
  // This middleware:
  // - Verifies JWT tokens
  // - Validates/creates user sessions
  // - Updates last activity time
  // - Attaches user info to req.user
  const authMiddleware = createAuthMiddleware(tokenVerifier, sessionService);

  // Step 5: Create Logout Handler
  // This handler clears the user session when they log out
  // Must be used AFTER auth middleware (so req.user is available)
  const logoutHandler = createLogoutHandler(sessionService);

  // Step 6: Set up Express app and routes
  const app = express();

  // Parse JSON request bodies
  app.use(express.json());

  // Protected route - requires authentication
  // This demonstrates how to protect API endpoints
  // The auth middleware automatically:
  // - Verifies the token
  // - Creates/validates session
  // - Updates activity
  // - Attaches user to req.user
  app.get('/test', authMiddleware, (req: Request, res: Response) => {
    // req.user is available after auth middleware
    // TypeScript types are extended by the library
    // The auth middleware ensures req.user is set before this handler runs
    const user = (req as Request & { user?: { sub: string; email?: string; name?: string } })
      .user;
    res.json({
      message: 'Protected route accessed successfully',
      user,
      timestamp: new Date().toISOString(),
    });
  });

  // Logout route - clears user session
  // This demonstrates the logout flow:
  // 1. User must be authenticated (auth middleware)
  // 2. Logout handler clears the session
  // 3. User must log in again to create a new session
  app.post('/auth/logout', authMiddleware, logoutHandler);

  return { app, firestoreSync };
}

/**
 * Get test configuration values
 *
 * Useful for tests that need to know the configured timeouts.
 *
 * @returns {typeof TEST_CONFIG} Test configuration
 */
export function getTestConfig() {
  return TEST_CONFIG;
}

/**
 * Get production default values for reference
 *
 * This helps tests understand what production values would be.
 *
 * @returns {typeof DEFAULTS} Production defaults
 */
export function getProductionDefaults() {
  return DEFAULTS;
}

