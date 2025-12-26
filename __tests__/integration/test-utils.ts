/**
 * Test Utilities for Integration Tests
 * 
 * This module provides helper functions for integration tests that demonstrate
 * real-world usage patterns. These utilities mirror what developers would do
 * in their applications when working with Firebase Auth and the auth library.
 * 
 * @module __tests__/integration/test-utils
 */

import { getEmulatorAuth, getEmulatorFirestore, getTestProjectId } from './firebase-setup.js';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, type User } from 'firebase/auth';

/**
 * Interface for test user creation options
 */
export interface TestUserOptions {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * Interface for test user with both Admin and Client SDK references
 */
export interface TestUser {
  uid: string;
  email: string;
  adminAuth: any; // Firebase Admin Auth user record
  clientUser: User | null; // Firebase Client SDK user (null until logged in)
}

/**
 * Create a test user in Firebase Auth emulator
 * 
 * This function demonstrates how to create users programmatically using
 * Firebase Admin SDK. In production, users typically sign up through your
 * application's UI, but for testing we create them directly.
 * 
 * The created user can then be used to test authentication flows, session
 * management, and other auth-related functionality.
 * 
 * @param {TestUserOptions} options - User creation options
 * @returns {Promise<TestUser>} Created user with UID and email
 * 
 * @example
 * ```typescript
 * // Create a test user
 * const user = await createTestUser({
 *   email: 'test@example.com',
 *   password: 'password123',
 *   displayName: 'Test User'
 * });
 * 
 * // Use the user in tests
 * const token = await getAuthToken(user.email, 'password123');
 * ```
 */
export async function createTestUser(options: TestUserOptions): Promise<TestUser> {
  const auth = getEmulatorAuth();

  // Create user using Admin SDK
  // In production, users would sign up through your app's UI
  const userRecord = await auth.createUser({
    email: options.email,
    password: options.password,
    displayName: options.displayName,
  });

  return {
    uid: userRecord.uid,
    email: userRecord.email || options.email,
    adminAuth: userRecord,
    clientUser: null, // Will be set when user logs in via client SDK
  };
}

/**
 * Get authentication token from Firebase Auth (Client SDK)
 * 
 * This function demonstrates the client-side token retrieval pattern that
 * developers use in their applications. It:
 * 1. Initializes Firebase Client SDK (if not already initialized)
 * 2. Signs in the user with email/password
 * 3. Retrieves the ID token
 * 
 * This mirrors what happens in a real application when a user logs in:
 * - User enters credentials in your app
 * - App calls signInWithEmailAndPassword()
 * - App gets the ID token to send with API requests
 * 
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<string>} Firebase ID token (JWT)
 * 
 * @example
 * ```typescript
 * // In a real app, this happens after user logs in
 * const token = await getAuthToken('user@example.com', 'password123');
 * 
 * // Use token in API requests
 * const response = await fetch('/api/protected', {
 *   headers: { Authorization: `Bearer ${token}` }
 * });
 * ```
 */
// Track if emulator is connected to avoid multiple connections
let emulatorConnected = false;

export async function getAuthToken(email: string, password: string): Promise<string> {
  const projectId = getTestProjectId();

  // Initialize Firebase Client SDK if not already initialized
  // In production, this would be done once at app startup
  let app;
  if (getApps().length === 0) {
    app = initializeApp({
      apiKey: 'fake-api-key',
      authDomain: 'localhost',
      projectId,
    });
  } else {
    app = getApps()[0];
  }

  const auth = getAuth(app);

  // Connect to Auth emulator if not already connected
  // In production, you would NOT call connectAuthEmulator
  // The emulator connection is only for testing
  // Note: connectAuthEmulator must be called before any auth operations
  if (!emulatorConnected) {
    try {
      connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      emulatorConnected = true;
    } catch (error: any) {
      // If already connected, the error will indicate that
      // We can safely continue - the emulator is already connected
      if (error.message?.includes('already been initialized')) {
        emulatorConnected = true;
      } else {
        throw error;
      }
    }
  }

  // Sign in the user (mirrors client-side login flow)
  // In production, this happens when user submits login form
  const userCredential = await signInWithEmailAndPassword(auth, email, password);

  // Get the ID token (this is what gets sent with API requests)
  // In production, this token is automatically included by the ApiClient
  const token = await userCredential.user.getIdToken();

  return token;
}

/**
 * Wait for session to expire
 * 
 * This utility helps test session expiration scenarios by waiting until
 * a session has expired. It polls Firestore to check if the session's
 * expiresAt timestamp has passed.
 * 
 * In production, you wouldn't need this - sessions expire naturally
 * based on inactivity. This is only for testing expiration behavior.
 * 
 * @param {string} userId - User ID whose session to check
 * @param {string} collectionName - Firestore collection name for sessions
 * @param {number} pollIntervalMs - How often to check (default: 1000ms)
 * @param {number} maxWaitMs - Maximum time to wait (default: 120000ms = 2 minutes)
 * @returns {Promise<void>} Resolves when session is expired
 * 
 * @example
 * ```typescript
 * // Wait for session to expire (useful for testing expiration scenarios)
 * await waitForSessionExpiration(userId, 'user_sessions');
 * 
 * // Now test that requests are rejected
 * const response = await fetch('/api/protected', {
 *   headers: { Authorization: `Bearer ${token}` }
 * });
 * expect(response.status).toBe(401);
 * ```
 */
export async function waitForSessionExpiration(
  userId: string,
  collectionName: string = 'user_sessions',
  pollIntervalMs: number = 1000,
  maxWaitMs: number = 120000,
): Promise<void> {
  const firestore = getEmulatorFirestore();
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkExpiration = async () => {
      try {
        const doc = await firestore.collection(collectionName).doc(userId).get();

        if (!doc.exists) {
          // Session doesn't exist, consider it "expired"
          resolve();
          return;
        }

        const data = doc.data();
        const expiresAt = data?.expiresAt?.toDate();

        if (expiresAt && expiresAt < new Date()) {
          // Session has expired
          resolve();
          return;
        }

        // Check if we've exceeded max wait time
        if (Date.now() - startTime > maxWaitMs) {
          reject(
            new Error(
              `Session did not expire within ${maxWaitMs}ms. Current expiresAt: ${expiresAt?.toISOString()}`,
            ),
          );
          return;
        }

        // Wait and check again
        setTimeout(checkExpiration, pollIntervalMs);
      } catch (error) {
        reject(error);
      }
    };

    checkExpiration();
  });
}

/**
 * Clean up test user and session data
 * 
 * This function removes all test data created during a test:
 * - Deletes the user from Firebase Auth
 * - Deletes the session from Firestore (if exists)
 * - Deletes logout record from Firestore (if exists)
 * 
 * It's important to clean up after tests to ensure test isolation.
 * In production, you wouldn't delete users - this is only for testing.
 * 
 * @param {string} userId - User ID to clean up
 * @param {string} sessionsCollection - Firestore collection name for sessions
 * @param {string} logoutsCollection - Firestore collection name for logouts
 * 
 * @example
 * ```typescript
 * // Clean up after test
 * afterEach(async () => {
 *   if (testUser) {
 *     await cleanupTestUser(testUser.uid);
 *   }
 * });
 * ```
 */
export async function cleanupTestUser(
  userId: string,
  sessionsCollection: string = 'user_sessions',
  logoutsCollection: string = 'user_logouts',
): Promise<void> {
  const auth = getEmulatorAuth();
  const firestore = getEmulatorFirestore();

  try {
    // Delete user from Auth
    await auth.deleteUser(userId);
  } catch (error: any) {
    // User might not exist, ignore error
    if (error.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  try {
    // Delete session document
    await firestore.collection(sessionsCollection).doc(userId).delete();
  } catch (error) {
    // Document might not exist, ignore error
  }

  try {
    // Delete logout record
    await firestore.collection(logoutsCollection).doc(userId).delete();
  } catch (error) {
    // Document might not exist, ignore error
  }
}

/**
 * Setup test environment
 * 
 * This is a convenience function that initializes the Firebase emulator
 * connection. It should be called once at the start of test suites.
 * 
 * In production, you would call initializeFirebaseAdmin() instead,
 * which requires credentials.
 * 
 * @returns {Promise<void>}
 * 
 * @example
 * ```typescript
 * // In test suite setup
 * beforeAll(async () => {
 *   await setupTestEnvironment();
 * });
 * ```
 */
/**
 * Setup test environment
 * 
 * This is a convenience function that initializes the Firebase emulator
 * connection. It should be called once at the start of test suites.
 * 
 * In production, you would call initializeFirebaseAdmin() instead,
 * which requires credentials.
 * 
 * @returns {Promise<void>}
 * 
 * @example
 * ```typescript
 * // In test suite setup
 * beforeAll(async () => {
 *   await setupTestEnvironment();
 * });
 * ```
 */
export async function setupTestEnvironment(): Promise<void> {
  const { initializeFirebaseEmulator } = await import('./firebase-setup.js');
  await initializeFirebaseEmulator();
}

/**
 * Read a Firestore document with retry logic for eventual consistency
 * 
 * Firestore is eventually consistent, which means writes may not be
 * immediately visible to reads. This function retries reads with exponential
 * backoff to handle this.
 * 
 * This is especially important in tests where we write to Firestore and
 * then immediately read to verify the write. In production, you typically
 * don't need this because you're not immediately reading after writing.
 * 
 * @param {string} collectionName - Firestore collection name
 * @param {string} docId - Document ID
 * @param {number} maxRetries - Maximum number of retries (default: 10)
 * @param {number} initialDelayMs - Initial delay between retries in ms (default: 100)
 * @returns {Promise<FirebaseFirestore.DocumentSnapshot>} Document snapshot
 * 
 * @example
 * ```typescript
 * // Read with retry to handle eventual consistency
 * const doc = await readFirestoreWithRetry('user_sessions', userId);
 * expect(doc.exists).toBe(true);
 * ```
 */
export async function readFirestoreWithRetry(
  collectionName: string,
  docId: string,
  maxRetries: number = 10,
  initialDelayMs: number = 100,
): Promise<import('firebase-admin/firestore').DocumentSnapshot> {
  const firestore = getEmulatorFirestore();
  let lastError: Error | null = null;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const doc = await firestore.collection(collectionName).doc(docId).get();
      return doc;
    } catch (error) {
      lastError = error as Error;
      // Exponential backoff: wait before retrying
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 1000); // Cap at 1 second
      }
    }
  }

  throw lastError || new Error(`Failed to read document after ${maxRetries} attempts`);
}

/**
 * Wait for a Firestore document to match a condition
 * 
 * This function polls Firestore until a document matches a given condition,
 * or until a timeout is reached. This is useful for testing eventual consistency
 * where writes may take time to be visible.
 * 
 * @param {string} collectionName - Firestore collection name
 * @param {string} docId - Document ID
 * @param {(doc: FirebaseFirestore.DocumentSnapshot) => boolean} condition - Condition function
 * @param {number} pollIntervalMs - How often to check (default: 200ms)
 * @param {number} maxWaitMs - Maximum time to wait (default: 5000ms)
 * @returns {Promise<FirebaseFirestore.DocumentSnapshot>} Document snapshot that matches condition
 * @throws {Error} If condition is not met within maxWaitMs
 * 
 * @example
 * ```typescript
 * // Wait for lastActivityAt to be updated
 * const doc = await waitForFirestoreCondition(
 *   'user_sessions',
 *   userId,
 *   (doc) => {
 *     const data = doc.data();
 *     return data && data.lastActivityAt.toDate().getTime() > initialTime;
 *   }
 * );
 * ```
 */
export async function waitForFirestoreCondition(
  collectionName: string,
  docId: string,
  condition: (doc: import('firebase-admin/firestore').DocumentSnapshot) => boolean,
  pollIntervalMs: number = 200,
  maxWaitMs: number = 5000,
): Promise<import('firebase-admin/firestore').DocumentSnapshot> {
  const firestore = getEmulatorFirestore();
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const doc = await firestore.collection(collectionName).doc(docId).get();
    
    if (condition(doc)) {
      return doc;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Final attempt
  const finalDoc = await firestore.collection(collectionName).doc(docId).get();
  if (condition(finalDoc)) {
    return finalDoc;
  }

  throw new Error(
    `Condition not met within ${maxWaitMs}ms for document ${collectionName}/${docId}`,
  );
}

/**
 * Ensure Firestore write is committed by reading back with retry
 * 
 * After writing to Firestore (especially through throttled writes),
 * this function ensures the write is visible by reading back with retry logic.
 * 
 * @param {string} collectionName - Firestore collection name
 * @param {string} docId - Document ID
 * @param {(doc: FirebaseFirestore.DocumentSnapshot) => boolean} verifyFn - Verification function
 * @param {number} maxWaitMs - Maximum time to wait (default: 5000ms)
 * @returns {Promise<void>}
 * 
 * @example
 * ```typescript
 * // After updating session, verify the update is visible
 * await ensureFirestoreWrite(
 *   'user_sessions',
 *   userId,
 *   (doc) => {
 *     const data = doc.data()!;
 *     return data.lastActivityAt.toDate().getTime() > initialTime;
 *   }
 * );
 * ```
 */
export async function ensureFirestoreWrite(
  collectionName: string,
  docId: string,
  verifyFn: (doc: import('firebase-admin/firestore').DocumentSnapshot) => boolean,
  maxWaitMs: number = 5000,
): Promise<void> {
  await waitForFirestoreCondition(collectionName, docId, verifyFn, 200, maxWaitMs);
}

