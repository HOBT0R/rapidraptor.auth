// Firebase Admin
export { initializeFirebaseAdmin, getFirestoreInstance, getAppInstance } from './firebase/admin.js';

// Session Management
export { SessionCache } from './session/sessionCache.js';
export { FirestoreSync } from './session/firestoreSync.js';
export { SessionService } from './session/sessionService.js';
export { createSessionService } from './config.js';

// Middleware
export { createAuthMiddleware } from './middleware/authMiddleware.js';
export type { UserTokenVerifier, UserTokenVerificationError, Logger } from './types/middleware.js';

// Re-export shared types
export type {
  SessionInfo,
  ErrorResponse,
  ErrorCode,
  SessionServiceConfig,
  FirestoreSessionDocument,
} from '@rapidraptor/auth-shared';

