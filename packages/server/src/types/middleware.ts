/**
 * Interface for user token verifier
 * Matches the UserTokenVerifier from the proxy service
 */
export interface UserTokenVerifier {
  verify(token: string, correlationId?: string): Promise<{ sub: string; email?: string; name?: string }>;
}

/**
 * Interface for user token verification error
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

