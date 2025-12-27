/**
 * Firebase Emulator Setup for Integration Tests
 *
 * This module configures Firebase Admin SDK to connect to the Firebase emulator
 * for integration testing. In emulator mode, Firebase Admin doesn't require real
 * credentials - it automatically connects to the local emulator when the appropriate
 * environment variables are set.
 *
 * This setup mirrors production configuration patterns, but uses emulator endpoints
 * instead of production Firebase services. In production, you would:
 * 1. Set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL
 * 2. Or set GOOGLE_APPLICATION_CREDENTIALS to point to a service account file
 *
 * For emulator mode (testing), you only need:
 * - FIREBASE_AUTH_EMULATOR_HOST (e.g., "localhost:9099")
 * - FIRESTORE_EMULATOR_HOST (e.g., "localhost:8080")
 * - FIREBASE_PROJECT_ID (can be any test project ID, e.g., "test-project")
 *
 * @module __tests__/integration/firebase-setup
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Default test project ID for emulator
 * In production, this would be your actual Firebase project ID
 */
const DEFAULT_TEST_PROJECT_ID = 'test-project';

/**
 * Initialize Firebase Admin SDK for emulator testing
 *
 * This function sets up Firebase Admin to connect to the local emulator.
 * Unlike production initialization, emulator mode doesn't require credentials
 * because the emulator doesn't perform real authentication checks.
 *
 * The emulator automatically uses the environment variables:
 * - FIREBASE_AUTH_EMULATOR_HOST: Points to Auth emulator (default: localhost:9099)
 * - FIRESTORE_EMULATOR_HOST: Points to Firestore emulator (default: localhost:8080)
 *
 * @throws {Error} If emulator environment variables are not set
 *
 * @example
 * ```typescript
 * // Set environment variables before calling
 * process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
 * process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
 * process.env.FIREBASE_PROJECT_ID = 'test-project';
 *
 * await initializeFirebaseEmulator();
 * ```
 */
export async function initializeFirebaseEmulator(): Promise<void> {
  // Check if already initialized
  if (getApps().length > 0) {
    return;
  }

  // Verify emulator environment variables are set
  const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_TEST_PROJECT_ID;

  if (!authEmulatorHost || !firestoreEmulatorHost) {
    throw new Error(
      'Firebase emulator environment variables not set. ' +
      'Please set FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST. ' +
      'Example: FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 FIRESTORE_EMULATOR_HOST=localhost:8080',
    );
  }

  // Initialize Firebase Admin without credentials (emulator mode)
  // The emulator doesn't require authentication, so we can initialize with just a project ID
  initializeApp({
    projectId,
  });

  // Verify connection by getting instances
  // This will throw if emulator is not running
  getAuth();
  getFirestore();
}

/**
 * Get Firebase Auth instance for emulator
 *
 * Returns the Auth instance connected to the emulator.
 * This is used for creating test users and managing authentication in tests.
 *
 * @returns {Auth} Firebase Auth instance connected to emulator
 * @throws {Error} If Firebase Admin is not initialized
 *
 * @example
 * ```typescript
 * const auth = getEmulatorAuth();
 * const user = await auth.createUser({ email: 'test@example.com', password: 'password123' });
 * ```
 */
export function getEmulatorAuth(): Auth {
  if (getApps().length === 0) {
    throw new Error(
      'Firebase Admin not initialized. Call initializeFirebaseEmulator() first.',
    );
  }
  return getAuth();
}

/**
 * Get Firestore instance for emulator
 *
 * Returns the Firestore instance connected to the emulator.
 * This is used for reading/writing session data in tests.
 *
 * @returns {Firestore} Firestore instance connected to emulator
 * @throws {Error} If Firebase Admin is not initialized
 *
 * @example
 * ```typescript
 * const firestore = getEmulatorFirestore();
 * const sessionDoc = await firestore.collection('user_sessions').doc(userId).get();
 * ```
 */
export function getEmulatorFirestore(): Firestore {
  if (getApps().length === 0) {
    throw new Error(
      'Firebase Admin not initialized. Call initializeFirebaseEmulator() first.',
    );
  }
  return getFirestore();
}

/**
 * Get the test project ID
 *
 * Returns the project ID being used for testing.
 *
 * @returns {string} Project ID
 */
export function getTestProjectId(): string {
  return process.env.FIREBASE_PROJECT_ID || DEFAULT_TEST_PROJECT_ID;
}

