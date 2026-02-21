import { readFileSync } from 'fs';
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let firestoreInstance: Firestore | null = null;
let appInstance: App | null = null;

/**
 * Credentials interface for Firebase Admin initialization
 */
interface FirebaseCredentials {
  projectId: string;
  privateKey: string;
  clientEmail: string;
}

/**
 * Get credentials from environment variables
 */
function getCredentialsFromEnv(): FirebaseCredentials | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (!projectId || !privateKey || !clientEmail) {
    return null;
  }

  return { projectId, privateKey, clientEmail };
}

/**
 * Get credentials from service account file
 */
function getCredentialsFromFile(): FirebaseCredentials | null {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!serviceAccountPath) {
    return null;
  }

  try {
    // Read and parse the JSON file explicitly (safer than require)
    const fileContents = readFileSync(serviceAccountPath, 'utf-8');
    const serviceAccount = JSON.parse(fileContents);
    return {
      projectId: serviceAccount.project_id,
      privateKey: serviceAccount.private_key,
      clientEmail: serviceAccount.client_email,
    };
  } catch (error) {
    console.error('Failed to load service account file:', error);
    return null;
  }
}

/**
 * Initialize Firebase Admin SDK
 * Can be called multiple times safely (idempotent)
 *
 * Supports emulator mode when FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST are set.
 * In emulator mode, credentials are not required.
 */
export async function initializeFirebaseAdmin(): Promise<void> {
  // Check if already initialized
  if (getApps().length > 0) {
    firestoreInstance = getFirestore();
    appInstance = getApps()[0];
    return;
  }

  // Check if emulator mode is enabled
  const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.FIREBASE_PROJECT_ID || 'demo-project';

  // Debug logging to help troubleshoot emulator detection
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
    console.log('[Firebase Admin] Environment check:');
    console.log(`  FIREBASE_AUTH_EMULATOR_HOST: ${authEmulatorHost || '(not set)'}`);
    console.log(`  FIRESTORE_EMULATOR_HOST: ${firestoreEmulatorHost || '(not set)'}`);
    console.log(`  FIREBASE_PROJECT_ID: ${projectId}`);
  }

  // Check if emulator mode is enabled (handle empty strings as falsy)
  const isEmulatorMode = !!(authEmulatorHost?.trim() || firestoreEmulatorHost?.trim());

  if (isEmulatorMode) {
    // Emulator mode: Initialize without credentials
    // Firebase Admin SDK automatically connects to emulators when env vars are set
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      console.log('[Firebase Admin] Initializing in emulator mode');
    }
    appInstance = initializeApp({
      projectId,
    });
    firestoreInstance = getFirestore(appInstance);
    return;
  }

  // Production mode: Try to get credentials from environment or file
  // Environment variables take precedence over file-based credentials
  const envCredentials = getCredentialsFromEnv();
  const fileCredentials = getCredentialsFromFile();

  // Warn if both are set (they might conflict)
  if (envCredentials && fileCredentials) {
    console.warn(
      'Both environment variables and service account file are set. Environment variables will be used.',
    );
  }

  const credentials = envCredentials || fileCredentials;

  if (!credentials) {
    // Provide helpful error message with current environment state
    const envVars = [
      `FIREBASE_AUTH_EMULATOR_HOST=${authEmulatorHost || '(not set)'}`,
      `FIRESTORE_EMULATOR_HOST=${firestoreEmulatorHost || '(not set)'}`,
      `FIREBASE_PROJECT_ID=${process.env.FIREBASE_PROJECT_ID || '(not set)'}`,
    ].join(', ');

    throw new Error(
      `Firebase Admin credentials not found. Set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL environment variables, or set GOOGLE_APPLICATION_CREDENTIALS to point to a service account file. For emulator mode, set FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST. Current env: ${envVars}`,
    );
  }

  // Initialize Firebase Admin
  appInstance = initializeApp({
    credential: cert({
      projectId: credentials.projectId,
      privateKey: credentials.privateKey,
      clientEmail: credentials.clientEmail,
    }),
    projectId: credentials.projectId,
  });

  // Get Firestore instance
  firestoreInstance = getFirestore(appInstance);
}

/**
 * Get Firestore instance
 * Throws if Firebase Admin is not initialized
 */
export function getFirestoreInstance(): Firestore {
  if (!firestoreInstance) {
    throw new Error(
      'Firebase Admin not initialized. Call initializeFirebaseAdmin() first.',
    );
  }
  return firestoreInstance;
}

/**
 * Get Firebase App instance
 * Throws if Firebase Admin is not initialized
 */
export function getAppInstance(): App {
  if (!appInstance) {
    throw new Error(
      'Firebase Admin not initialized. Call initializeFirebaseAdmin() first.',
    );
  }
  return appInstance;
}

