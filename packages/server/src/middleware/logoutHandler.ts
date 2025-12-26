import type { Request, Response, NextFunction, RequestHandler } from 'express';

import { ERROR_CODES } from '@rapidraptor/auth-shared';
import type { ErrorResponse } from '@rapidraptor/auth-shared';

import { SessionService } from '../session/sessionService.js';
import type { Logger } from '../types/middleware.js';

/**
 * Create logout handler for clearing sessions on logout
 * Must be used AFTER auth middleware to ensure req.user is set
 */
export function createLogoutHandler(sessionService: SessionService, logger?: Logger): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requestLogger: Logger | undefined = req.logger || logger;

    try {
      // Extract user from authenticated request (set by auth middleware)
      const user = req.user;

      if (!user?.sub) {
        // User not authenticated - return error
        requestLogger?.warn?.('Logout attempted without authentication', {
          event: 'logout_unauthorized',
          correlationId: req.correlationId,
        });

        res.status(401).json({
          error: {
            code: ERROR_CODES.AUTH_FAILED,
            message: 'Authentication required for logout',
            requiresLogout: false,
            sessionExpired: false,
            timestamp: new Date().toISOString(),
          },
        } as ErrorResponse);
        return;
      }

      // Clear session (idempotent - safe to call multiple times)
      await sessionService.clearSession(user.sub);

      requestLogger?.info?.('Session cleared on logout', {
        event: 'session_cleared',
        userId: user.sub,
        correlationId: req.correlationId,
      });

      // Return success response
      res.status(200).json({
        message: 'Logged out successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Handle errors gracefully
      requestLogger?.error?.('Logout handler error', {
        event: 'logout_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.sub,
        correlationId: req.correlationId,
      });
      next(error);
    }
  };
}

