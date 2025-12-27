/**
 * Interface for user token verifier
 * Implementations should verify JWT tokens (signature, expiration, issuer, audience)
 * and return the user information from the token payload.
 *
 * This is a generic interface that can be implemented by any project using this library.
 * The implementation is provided via dependency injection to createAuthMiddleware().
 */
export interface UserTokenVerifier {
  verify(token: string, correlationId?: string): Promise<{ sub: string; email?: string; name?: string }>;
}

/**
 * Interface for user token verification error
 * Implementations should throw errors that match this interface
 */
export interface UserTokenVerificationError extends Error {
  isExpired?: boolean;
}

/**
 * Logger interface (compatible with winston)
 * Uses Record<string, unknown> for type-safe metadata
 */
export interface Logger {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
}

