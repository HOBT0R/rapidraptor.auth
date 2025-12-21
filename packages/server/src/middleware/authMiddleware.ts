import type { Request, Response, NextFunction, RequestHandler } from 'express';

import { ERROR_CODES } from '@rapidraptor/auth-shared';
import type { ErrorResponse } from '@rapidraptor/auth-shared';

import { SessionService } from '../session/sessionService.js';
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
      let isValid: boolean;
      try {
        isValid = await sessionService.isSessionValid(user.sub);
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

      if (isValid) {
        // Session is valid - update activity (async, don't wait)
        sessionService.updateLastActivity(user.sub).catch((err) => {
          requestLogger?.error?.('Failed to update activity', {
            event: 'activity_update_failed',
            error: err instanceof Error ? err.message : 'Unknown error',
            userId: user.sub,
            correlationId: req.correlationId,
          });
        });
      } else {
        // Session invalid - try to ensure session exists (idempotent, handles race conditions)
        const wasCreated = await sessionService.ensureSession(user.sub);

        // Step 1: Check if session was created
        if (wasCreated) {
          // Session was created, continue
          requestLogger?.info?.('Session created', {
            event: 'session_created',
            userId: user.sub,
            correlationId: req.correlationId,
          });
        } else {
          // Session exists but expired
          requestLogger?.warn?.('Session expired', {
            event: 'session_expired',
            userId: user.sub,
            correlationId: req.correlationId,
          });

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
        }
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

