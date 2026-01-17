// Firebase Admin
export { initializeFirebaseAdmin, getFirestoreInstance, getAppInstance } from './firebase/admin.js';

// Session Management
export { SessionCache } from './session/sessionCache.js';
export { FirestoreSync } from './session/firestoreSync.js';
export { SessionService, TokenRevokedError } from './session/sessionService.js';
export { createSessionService } from './config.js';

// Middleware
export { createAuthMiddleware } from './middleware/authMiddleware.js';
export { createLogoutHandler } from './middleware/logoutHandler.js';
export type { UserTokenVerifier, UserTokenVerificationError, Logger } from './types/middleware.js';

// Token Verifier (Default Implementation)
export { JoseTokenVerifier } from './tokenVerifier/joseTokenVerifier.js';
export type { TokenVerifierConfig } from './tokenVerifier/types.js';
export {
  TokenVerificationError,
  TokenVerificationFailedError,
  TokenVerifierConfigurationError,
} from './tokenVerifier/errors.js';

// Re-export shared types and enums
export type {
  SessionInfo,
  ErrorResponse,
  ErrorCode,
  SessionServiceConfig,
  FirestoreSessionDocument,
  FirestoreLogoutDocument,
} from '@rapidraptor/auth-shared';
export { SessionValidationStatus, ERROR_CODES } from '@rapidraptor/auth-shared';
