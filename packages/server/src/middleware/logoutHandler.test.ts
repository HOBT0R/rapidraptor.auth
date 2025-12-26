import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createLogoutHandler } from './logoutHandler.js';
import { SessionService } from '../session/sessionService.js';
import { SessionCache } from '../session/sessionCache.js';
import { FirestoreSync } from '../session/firestoreSync.js';
import type { Firestore } from 'firebase-admin/firestore';
import { ERROR_CODES } from '@rapidraptor/auth-shared';

describe('createLogoutHandler', () => {
  let logoutHandler: ReturnType<typeof createLogoutHandler>;
  let sessionService: SessionService;
  let mockFirestore: Firestore;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
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

    logoutHandler = createLogoutHandler(sessionService);

    mockRequest = {
      user: {
        sub: 'user123',
        email: 'user@example.com',
      },
      correlationId: 'test-correlation-id',
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn() as unknown as NextFunction;
  });

  it('should clear session and return 200 on successful logout', async () => {
    const clearSessionSpy = vi.spyOn(sessionService, 'clearSession').mockResolvedValue(undefined);

    await logoutHandler(mockRequest as Request, mockResponse as Response, mockNext);

    expect(clearSessionSpy).toHaveBeenCalledWith('user123');
    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.json).toHaveBeenCalledWith({
      message: 'Logged out successfully',
      timestamp: expect.any(String),
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 if user is not authenticated', async () => {
    mockRequest.user = undefined;

    await logoutHandler(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        code: ERROR_CODES.AUTH_FAILED,
        message: 'Authentication required for logout',
        requiresLogout: false,
        sessionExpired: false,
        timestamp: expect.any(String),
      },
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 if user.sub is missing', async () => {
    mockRequest.user = {
      email: 'user@example.com',
    } as any;

    await logoutHandler(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        code: ERROR_CODES.AUTH_FAILED,
        message: 'Authentication required for logout',
        requiresLogout: false,
        sessionExpired: false,
        timestamp: expect.any(String),
      },
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully and call next', async () => {
    const error = new Error('Firestore error');
    vi.spyOn(sessionService, 'clearSession').mockRejectedValue(error);

    await logoutHandler(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith(error);
  });

  it('should be idempotent (safe to call multiple times)', async () => {
    const clearSessionSpy = vi.spyOn(sessionService, 'clearSession').mockResolvedValue(undefined);

    // Call logout multiple times
    await logoutHandler(mockRequest as Request, mockResponse as Response, mockNext);
    await logoutHandler(mockRequest as Request, mockResponse as Response, mockNext);
    await logoutHandler(mockRequest as Request, mockResponse as Response, mockNext);

    expect(clearSessionSpy).toHaveBeenCalledTimes(3);
    expect(clearSessionSpy).toHaveBeenCalledWith('user123');
  });
});

