import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { decodeJwt } from 'jose';

import { ERROR_CODES, SessionValidationStatus } from '@rapidraptor/auth-shared';
import type { ErrorResponse } from '@rapidraptor/auth-shared';

import { SessionService, TokenRevokedError } from '../session/sessionService.js';
import type { UserTokenVerifier, UserTokenVerificationError, Logger } from '../types/middleware.js';

/**
 * Type guard for errors with code property (e.g., Firestore errors)
 */
function isErrorWithCode(error: unknown): error is { code: string; message?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

/**
 * Handle token revocation error response
 */
function handleTokenRevoked(
  res: Response,
  requestLogger: Logger | undefined,
  userId: string,
  tokenIssuedAt: Date,
  correlationId?: string,
): void {
  requestLogger?.warn?.('Token revoked (issued before logout)', {
    event: 'token_revoked',
    userId,
    tokenIssuedAt: tokenIssuedAt.toISOString(),
    correlationId,
  });

  res.status(401).json({
    error: {
      code: ERROR_CODES.SESSION_EXPIRED,
      message: 'This token was issued before logout. Please log in again.',
      requiresLogout: true,
      sessionExpired: true,
      timestamp: new Date().toISOString(),
    },
  } as ErrorResponse);
}

/**
 * Create authentication middleware with session validation
 * Wraps existing JWT verifier and adds session management
 */
export function createAuthMiddleware(
  userTokenVerifier: UserTokenVerifier,
  sessionService: SessionService,
  logger?: Logger,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Type-safe access with Express type extensions
    const requestLogger: Logger | undefined = req.logger || logger;

    try {
      // Phase 1: JWT verification (existing logic)
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({
          error: {
            code: ERROR_CODES.AUTH_FAILED,
            message: 'Authorization header required',
            requiresLogout: false,
            sessionExpired: false,
            timestamp: new Date().toISOString(),
          },
        } as ErrorResponse);
        return;
      }

      const token = authHeader.split(' ')[1];
      let user: { sub: string; email?: string; name?: string };
      let tokenIssuedAt: Date;

      // Decode JWT to extract iat (issued at) timestamp
      // This is needed to check if token was issued before logout
      try {
        const decoded = decodeJwt(token);
        // iat is in seconds, convert to milliseconds for Date
        tokenIssuedAt = new Date((decoded.iat || 0) * 1000);
      } catch (error) {
        // If we can't decode, assume token is invalid
        requestLogger?.warn?.('Failed to decode JWT', {
          event: 'jwt_decode_failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          correlationId: req.correlationId,
        });

        res.status(401).json({
          error: {
            code: ERROR_CODES.AUTH_FAILED,
            message: 'Invalid token format',
            requiresLogout: false,
            sessionExpired: false,
            timestamp: new Date().toISOString(),
          },
        } as ErrorResponse);
        return;
      }

      try {
        // Type-safe access with Express type extensions
        const correlationId = req.correlationId;
        user = await userTokenVerifier.verify(token, correlationId);
      } catch (error: unknown) {
        // Handle JWT verification errors
        const isExpired = (error as UserTokenVerificationError).isExpired === true;

        requestLogger?.warn?.('JWT verification failed', {
          event: 'jwt_verification_failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          isExpired,
          correlationId: req.correlationId,
        });

        res.status(401).json({
          error: {
            code: isExpired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.AUTH_FAILED,
            message: error instanceof Error ? error.message : 'Authentication failed',
            requiresLogout: isExpired,
            sessionExpired: false,
            timestamp: new Date().toISOString(),
          },
        } as ErrorResponse);
        return;
      }

      // Phase 2: Session validation (new)
      let validationStatus: SessionValidationStatus;
      try {
        validationStatus = await sessionService.validateSession(user.sub);
      } catch (error: unknown) {
        // Handle Firestore unavailability with proper type checking
        if (isErrorWithCode(error) && (error.code === 'unavailable' || error.code === 'deadline-exceeded')) {
          requestLogger?.error?.('Firestore unavailable for session validation', {
            event: 'firestore_unavailable',
            error: error.message || 'Unknown error',
            userId: user.sub,
            correlationId: req.correlationId,
          });

          res.status(503).json({
            error: {
              code: ERROR_CODES.SERVICE_UNAVAILABLE,
              message: 'User sessions could not be validated',
              requiresLogout: false,
              sessionExpired: false,
              timestamp: new Date().toISOString(),
            },
          } as ErrorResponse);
          return;
        }
        // Re-throw other errors
        throw error;
      }

      if (validationStatus === SessionValidationStatus.VALID) {
        // Session is valid - update activity (async, don't wait)
        sessionService.updateLastActivity(user.sub).catch((err) => {
          requestLogger?.error?.('Failed to update activity', {
            event: 'activity_update_failed',
            error: err instanceof Error ? err.message : 'Unknown error',
            userId: user.sub,
            correlationId: req.correlationId,
          });
        });
        // Continue to attach user and proceed
      } else if (validationStatus === SessionValidationStatus.EXPIRED) {
        requestLogger?.warn?.('Session expired', {
          event: 'session_expired',
          userId: user.sub,
          correlationId: req.correlationId,
        });

        try {
          await sessionService.clearSession(user.sub);
        } catch (error: unknown) {
          requestLogger?.error?.('Failed to clear expired session', {
            event: 'clear_session_failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            userId: user.sub,
            correlationId: req.correlationId,
          });
        }

        res.status(401).json({
          error: {
            code: ERROR_CODES.SESSION_EXPIRED,
            message: 'Session has expired due to inactivity',
            requiresLogout: true,
            sessionExpired: true,
            timestamp: new Date().toISOString(),
          },
        } as ErrorResponse);
        return;
      } else if (validationStatus === SessionValidationStatus.NOT_FOUND) {
        // Session doesn't exist - ensureSession will check token revocation and create session if needed
        try {
          await sessionService.ensureSession(user.sub, tokenIssuedAt);
          requestLogger?.info?.('Session created', {
            event: 'session_created',
            userId: user.sub,
            correlationId: req.correlationId,
          });
        } catch (error: unknown) {
          // Handle TokenRevokedError from ensureSession
          if (error instanceof TokenRevokedError) {
            handleTokenRevoked(res, requestLogger, user.sub, tokenIssuedAt, req.correlationId);
            return;
          }
          // Handle Firestore unavailability (from validateSession or createSession)
          if (isErrorWithCode(error) && (error.code === 'unavailable' || error.code === 'deadline-exceeded')) {
            requestLogger?.error?.('Firestore unavailable for session creation', {
              event: 'firestore_unavailable',
              error: error.message || 'Unknown error',
              userId: user.sub,
              correlationId: req.correlationId,
            });

            res.status(503).json({
              error: {
                code: ERROR_CODES.SERVICE_UNAVAILABLE,
                message: 'User sessions could not be created',
                requiresLogout: false,
                sessionExpired: false,
                timestamp: new Date().toISOString(),
              },
            } as ErrorResponse);
            return;
          }
          // Re-throw other errors
          throw error;
        }
      } else if (validationStatus === SessionValidationStatus.DATA_INTEGRITY_ERROR) {
        // Data integrity issue - reject request
        requestLogger?.error?.('Session data integrity error', {
          event: 'session_data_integrity_error',
          userId: user.sub,
          correlationId: req.correlationId,
        });

        res.status(500).json({
          error: {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'Session data integrity error',
            requiresLogout: true,
            sessionExpired: false,
            timestamp: new Date().toISOString(),
          },
        } as ErrorResponse);
        return;
      }

      // Attach user to request - now type-safe
      req.user = user;
      next();
    } catch (error) {
      requestLogger?.error?.('Authentication middleware error', {
        event: 'auth_middleware_error',
        error: {
          name: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        correlationId: req.correlationId,
      });
      next(error);
    }
  };
}
