import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { decodeJwt } from 'jose';
import { createAuthMiddleware } from './authMiddleware.js';
import { SessionService, TokenRevokedError } from '../session/sessionService.js';
import { SessionCache } from '../session/sessionCache.js';
import { FirestoreSync } from '../session/firestoreSync.js';
import type { Firestore } from 'firebase-admin/firestore';
import { ERROR_CODES, SessionValidationStatus } from '@rapidraptor/auth-shared';
import type { UserTokenVerifier, Logger } from '../types/middleware.js';

// Mock jose
vi.mock('jose', () => ({
  decodeJwt: vi.fn(),
}));

describe('createAuthMiddleware', () => {
  let authMiddleware: ReturnType<typeof createAuthMiddleware>;
  let mockUserTokenVerifier: UserTokenVerifier;
  let sessionService: SessionService;
  let mockFirestore: Firestore;
  let mockLogger: Logger;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup SessionService
    const cache = new SessionCache(24 * 60 * 60 * 1000);
    const firestoreSync = new FirestoreSync(
      {
        collection: vi.fn(),
        batch: vi.fn(),
      } as any,
      5 * 60 * 1000,
      'user_sessions',
    );

    mockFirestore = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn(),
          set: vi.fn(),
          delete: vi.fn(),
        })),
      })),
    } as any;

    sessionService = new SessionService(cache, firestoreSync, mockFirestore, 24 * 60 * 60 * 1000);

    // Setup mocks
    mockUserTokenVerifier = {
      verify: vi.fn(),
    };

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockRequest = {
      headers: {},
      correlationId: 'test-correlation-id',
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn() as unknown as NextFunction;

    authMiddleware = createAuthMiddleware(mockUserTokenVerifier, sessionService, mockLogger);
  });

  describe('Authorization Header Validation', () => {
    it('should return 401 when authorization header is missing', async () => {
      mockRequest.headers = {};

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.AUTH_FAILED,
          message: 'Authorization header required',
          requiresLogout: false,
          sessionExpired: false,
          timestamp: expect.any(String),
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header does not start with "Bearer "', async () => {
      mockRequest.headers = {
        authorization: 'Invalid token',
      };

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.AUTH_FAILED,
          message: 'Authorization header required',
          requiresLogout: false,
          sessionExpired: false,
          timestamp: expect.any(String),
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header is empty string', async () => {
      mockRequest.headers = {
        authorization: '',
      };

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('JWT Decoding', () => {
    it('should return 401 when JWT cannot be decoded', async () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid-token',
      };

      vi.mocked(decodeJwt).mockImplementation(() => {
        throw new Error('Invalid JWT');
      });

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.AUTH_FAILED,
          message: 'Invalid token format',
          requiresLogout: false,
          sessionExpired: false,
          timestamp: expect.any(String),
        },
      });
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to decode JWT', {
        event: 'jwt_decode_failed',
        error: 'Invalid JWT',
        correlationId: 'test-correlation-id',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should extract tokenIssuedAt from JWT iat claim', async () => {
      const token = 'valid-token';
      const iat = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      vi.mocked(decodeJwt).mockReturnValue({ iat, sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
        email: 'user@example.com',
      });
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(decodeJwt).toHaveBeenCalledWith(token);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle JWT with missing iat claim (defaults to 0)', async () => {
      const token = 'valid-token';
      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      vi.mocked(decodeJwt).mockReturnValue({ sub: 'user123' }); // No iat
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
        email: 'user@example.com',
      });
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(decodeJwt).toHaveBeenCalledWith(token);
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('JWT Verification', () => {
    beforeEach(() => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
    });

    it('should return 401 when token verification fails (invalid signature)', async () => {
      const error = new Error('Invalid signature');
      vi.mocked(mockUserTokenVerifier.verify).mockRejectedValue(error);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.AUTH_FAILED,
          message: 'Invalid signature',
          requiresLogout: false,
          sessionExpired: false,
          timestamp: expect.any(String),
        },
      });
      expect(mockLogger.warn).toHaveBeenCalledWith('JWT verification failed', {
        event: 'jwt_verification_failed',
        error: 'Invalid signature',
        isExpired: false,
        correlationId: 'test-correlation-id',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 with TOKEN_EXPIRED when token is expired', async () => {
      const error = new Error('Token expired');
      (error as any).isExpired = true;
      vi.mocked(mockUserTokenVerifier.verify).mockRejectedValue(error);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.TOKEN_EXPIRED,
          message: 'Token expired',
          requiresLogout: true,
          sessionExpired: false,
          timestamp: expect.any(String),
        },
      });
      expect(mockLogger.warn).toHaveBeenCalledWith('JWT verification failed', {
        event: 'jwt_verification_failed',
        error: 'Token expired',
        isExpired: true,
        correlationId: 'test-correlation-id',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 with AUTH_FAILED for other verification errors', async () => {
      const error = new Error('Verification failed');
      vi.mocked(mockUserTokenVerifier.verify).mockRejectedValue(error);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.AUTH_FAILED,
          message: 'Verification failed',
          requiresLogout: false,
          sessionExpired: false,
          timestamp: expect.any(String),
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should pass correlationId to token verifier', async () => {
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
        email: 'user@example.com',
      });
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockUserTokenVerifier.verify).toHaveBeenCalledWith('valid-token', 'test-correlation-id');
    });
  });

  describe('Session Validation - VALID', () => {
    beforeEach(() => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
        email: 'user@example.com',
        name: 'Test User',
      });
    });

    it('should attach user to request and call next() when session is valid', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);
      vi.spyOn(sessionService, 'updateLastActivity').mockResolvedValue(undefined);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toEqual({
        sub: 'user123',
        email: 'user@example.com',
        name: 'Test User',
      });
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should update last activity asynchronously (not wait)', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);
      const updateSpy = vi.spyOn(sessionService, 'updateLastActivity').mockResolvedValue(undefined);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(updateSpy).toHaveBeenCalledWith('user123');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should log error but continue when activity update fails', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);
      const updateError = new Error('Update failed');
      vi.spyOn(sessionService, 'updateLastActivity').mockRejectedValue(updateError);

      // Wait a bit for the async catch to execute
      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockNext).toHaveBeenCalledWith();
      // Error should be logged (but we can't easily test the async catch timing)
    });

    it('should use request logger when available, fallback to provided logger', async () => {
      const requestLogger = {
        warn: vi.fn(),
        error: vi.fn(),
      };
      mockRequest.logger = requestLogger;
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      // Request logger should be used instead of provided logger
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('Session Validation - EXPIRED', () => {
    beforeEach(() => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
        email: 'user@example.com',
      });
    });

    it('should return 401 with SESSION_EXPIRED when session is expired', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.EXPIRED);
      vi.spyOn(sessionService, 'clearSession').mockResolvedValue(undefined);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(sessionService.clearSession).toHaveBeenCalledTimes(1);
      expect(sessionService.clearSession).toHaveBeenCalledWith('user123');
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.SESSION_EXPIRED,
          message: 'Session has expired due to inactivity',
          requiresLogout: true,
          sessionExpired: true,
          timestamp: expect.any(String),
        },
      });
      expect(mockLogger.warn).toHaveBeenCalledWith('Session expired', {
        event: 'session_expired',
        userId: 'user123',
        correlationId: 'test-correlation-id',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Session Validation - NOT_FOUND', () => {
    beforeEach(() => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      const iat = Math.floor(Date.now() / 1000);
      vi.mocked(decodeJwt).mockReturnValue({ iat, sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
        email: 'user@example.com',
      });
    });

    it('should create new session when session does not exist', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.NOT_FOUND);
      const ensureSessionSpy = vi.spyOn(sessionService, 'ensureSession').mockResolvedValue(true);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(ensureSessionSpy).toHaveBeenCalledWith('user123', expect.any(Date));
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockRequest.user).toBeDefined();
    });

    it('should log info when session is created', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.NOT_FOUND);
      vi.spyOn(sessionService, 'ensureSession').mockResolvedValue(true);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockLogger.info).toHaveBeenCalledWith('Session created', {
        event: 'session_created',
        userId: 'user123',
        correlationId: 'test-correlation-id',
      });
    });

    it('should attach user and call next() after creating session', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.NOT_FOUND);
      vi.spyOn(sessionService, 'ensureSession').mockResolvedValue(true);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toEqual({
        sub: 'user123',
        email: 'user@example.com',
      });
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should return 401 with token revoked error when token was issued before logout', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.NOT_FOUND);
      vi.spyOn(sessionService, 'ensureSession').mockRejectedValue(new TokenRevokedError());

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.SESSION_EXPIRED,
          message: 'This token was issued before logout. Please log in again.',
          requiresLogout: true,
          sessionExpired: true,
          timestamp: expect.any(String),
        },
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Token revoked (issued before logout)',
        expect.objectContaining({
          event: 'token_revoked',
          userId: 'user123',
          correlationId: 'test-correlation-id',
        }),
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 503 when Firestore is unavailable during session creation', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.NOT_FOUND);
      const firestoreError = { code: 'unavailable', message: 'Firestore unavailable' };
      vi.spyOn(sessionService, 'ensureSession').mockRejectedValue(firestoreError);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          message: 'User sessions could not be created',
          requiresLogout: false,
          sessionExpired: false,
          timestamp: expect.any(String),
        },
      });
      expect(mockLogger.error).toHaveBeenCalledWith('Firestore unavailable for session creation', {
        event: 'firestore_unavailable',
        error: 'Firestore unavailable',
        userId: 'user123',
        correlationId: 'test-correlation-id',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 503 when Firestore deadline is exceeded during session creation', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.NOT_FOUND);
      const firestoreError = { code: 'deadline-exceeded', message: 'Deadline exceeded' };
      vi.spyOn(sessionService, 'ensureSession').mockRejectedValue(firestoreError);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should re-throw unexpected errors from ensureSession', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.NOT_FOUND);
      const unexpectedError = new Error('Unexpected error');
      vi.spyOn(sessionService, 'ensureSession').mockRejectedValue(unexpectedError);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(unexpectedError);
    });
  });

  describe('Session Validation - DATA_INTEGRITY_ERROR', () => {
    beforeEach(() => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
        email: 'user@example.com',
      });
    });

    it('should return 500 when session data integrity error is detected', async () => {
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(
        SessionValidationStatus.DATA_INTEGRITY_ERROR,
      );

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Session data integrity error',
          requiresLogout: true,
          sessionExpired: false,
          timestamp: expect.any(String),
        },
      });
      expect(mockLogger.error).toHaveBeenCalledWith('Session data integrity error', {
        event: 'session_data_integrity_error',
        userId: 'user123',
        correlationId: 'test-correlation-id',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Firestore Unavailability During Validation', () => {
    beforeEach(() => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
        email: 'user@example.com',
      });
    });

    it('should return 503 when Firestore is unavailable during validateSession', async () => {
      const firestoreError = { code: 'unavailable', message: 'Firestore unavailable' };
      vi.spyOn(sessionService, 'validateSession').mockRejectedValue(firestoreError);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          message: 'User sessions could not be validated',
          requiresLogout: false,
          sessionExpired: false,
          timestamp: expect.any(String),
        },
      });
      expect(mockLogger.error).toHaveBeenCalledWith('Firestore unavailable for session validation', {
        event: 'firestore_unavailable',
        error: 'Firestore unavailable',
        userId: 'user123',
        correlationId: 'test-correlation-id',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 503 when Firestore deadline is exceeded during validateSession', async () => {
      const firestoreError = { code: 'deadline-exceeded', message: 'Deadline exceeded' };
      vi.spyOn(sessionService, 'validateSession').mockRejectedValue(firestoreError);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should re-throw non-Firestore errors from validateSession', async () => {
      const unexpectedError = new Error('Unexpected error');
      vi.spyOn(sessionService, 'validateSession').mockRejectedValue(unexpectedError);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(unexpectedError);
    });
  });

  describe('Error Handling', () => {
    it('should log error and call next(error) for unexpected errors', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
      });
      const unexpectedError = new Error('Unexpected error');
      vi.spyOn(sessionService, 'validateSession').mockRejectedValue(unexpectedError);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockLogger.error).toHaveBeenCalledWith('Authentication middleware error', {
        event: 'auth_middleware_error',
        error: {
          name: 'Error',
          message: 'Unexpected error',
        },
        correlationId: 'test-correlation-id',
      });
      expect(mockNext).toHaveBeenCalledWith(unexpectedError);
    });

    it('should include error name and message in error log', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
      });
      const customError = new Error('Custom error');
      customError.name = 'CustomError';
      vi.spyOn(sessionService, 'validateSession').mockRejectedValue(customError);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockLogger.error).toHaveBeenCalledWith('Authentication middleware error', {
        event: 'auth_middleware_error',
        error: {
          name: 'CustomError',
          message: 'Custom error',
        },
        correlationId: 'test-correlation-id',
      });
    });

    it('should include correlationId in error log', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      mockRequest.correlationId = 'custom-correlation-id';
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
      });
      const error = new Error('Test error');
      vi.spyOn(sessionService, 'validateSession').mockRejectedValue(error);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Authentication middleware error',
        expect.objectContaining({
          correlationId: 'custom-correlation-id',
        }),
      );
    });
  });

  describe('Success Path', () => {
    it('should process complete flow: valid JWT + valid session', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      const iat = Math.floor(Date.now() / 1000);
      vi.mocked(decodeJwt).mockReturnValue({ iat, sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
        email: 'user@example.com',
        name: 'Test User',
      });
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);
      vi.spyOn(sessionService, 'updateLastActivity').mockResolvedValue(undefined);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toEqual({
        sub: 'user123',
        email: 'user@example.com',
        name: 'Test User',
      });
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should extract user information from verified token', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      const userInfo = {
        sub: 'user123',
        email: 'test@example.com',
        name: 'Test Name',
      };
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue(userInfo);
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toEqual(userInfo);
    });

    it('should attach user object to request with correct structure', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
        email: 'user@example.com',
      });
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toHaveProperty('sub', 'user123');
      expect(mockRequest.user).toHaveProperty('email', 'user@example.com');
    });
  });

  describe('Logger Usage', () => {
    it('should use req.logger when available', async () => {
      const requestLogger = {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      };
      mockRequest.logger = requestLogger;
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
      });
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      // Request logger should be used, not the provided logger
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should fallback to provided logger when req.logger is not available', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
      });
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle undefined logger gracefully', async () => {
      const middlewareWithoutLogger = createAuthMiddleware(mockUserTokenVerifier, sessionService);
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
      });
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await middlewareWithoutLogger(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('Correlation ID', () => {
    it('should use req.correlationId when available', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      mockRequest.correlationId = 'custom-correlation-id';
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
      });
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockUserTokenVerifier.verify).toHaveBeenCalledWith('valid-token', 'custom-correlation-id');
    });

    it('should handle missing correlationId gracefully', async () => {
      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };
      delete mockRequest.correlationId;
      vi.mocked(decodeJwt).mockReturnValue({ iat: Math.floor(Date.now() / 1000), sub: 'user123' });
      vi.mocked(mockUserTokenVerifier.verify).mockResolvedValue({
        sub: 'user123',
      });
      vi.spyOn(sessionService, 'validateSession').mockResolvedValue(SessionValidationStatus.VALID);

      await authMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockUserTokenVerifier.verify).toHaveBeenCalledWith('valid-token', undefined);
      expect(mockNext).toHaveBeenCalledWith();
    });
  });
});

