import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorHandler } from './errorHandler.js';
import { TokenManager } from './tokenManager.js';
import { ERROR_CODES } from '@rapidraptor/auth-shared';
import type { AxiosError, AxiosInstance } from 'axios';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;
  let tokenManager: TokenManager;
  let mockClient: AxiosInstance;
  let onLogout: () => void | Promise<void>;

  beforeEach(() => {
    onLogout = vi.fn<[], void>();
    errorHandler = new ErrorHandler(onLogout);

    // Mock TokenManager

    tokenManager = {
      refreshToken: vi.fn(),
    } as any;

    // Mock Axios client

    mockClient = {
      request: vi.fn(),
    } as any;
  });

  describe('handle401Error', () => {
    describe('SESSION_EXPIRED', () => {
      it('should call onLogout and reject with SESSION_EXPIRED', async () => {
        const error = {
          response: {
            status: 401,
            data: {
              error: {
                code: ERROR_CODES.SESSION_EXPIRED,
                message: 'Session expired',
              },
            },
          },
        } as AxiosError;

        await expect(
          errorHandler.handle401Error(error, tokenManager, mockClient, 1),
        ).rejects.toMatchObject({
          code: ERROR_CODES.SESSION_EXPIRED,
          sessionExpired: true,
        });

        expect(onLogout).toHaveBeenCalledOnce();
        expect(tokenManager.refreshToken).not.toHaveBeenCalled();
      });
    });

    describe('TOKEN_EXPIRED', () => {
      it('should refresh token and retry request on first attempt', async () => {
        const newToken = 'new-token';
        (tokenManager.refreshToken as ReturnType<typeof vi.fn>).mockResolvedValue(newToken);
        (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue({ data: 'success' });

        const error = {
          response: {
            status: 401,
            data: {
              error: {
                code: ERROR_CODES.TOKEN_EXPIRED,
                message: 'Token expired',
              },
            },
          },
          config: {
            headers: {},
            _retryCount: 0,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        const result = await errorHandler.handle401Error(error, tokenManager, mockClient, 1);

        expect(tokenManager.refreshToken).toHaveBeenCalledOnce();
        expect(mockClient.request).toHaveBeenCalledWith(
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${newToken}`,
            }),
            _retryCount: 1,
          }),
        );
        expect(result).toEqual({ data: 'success' });
        expect(onLogout).not.toHaveBeenCalled();
      });

      it('should call onLogout when max retries exceeded', async () => {

        const error = {
          response: {
            status: 401,
            data: {
              error: {
                code: ERROR_CODES.TOKEN_EXPIRED,
                message: 'Token expired',
              },
            },
          },
          config: {
            headers: {},
            _retryCount: 1, // Already at max retries
          },
        } as any;

        await expect(
          errorHandler.handle401Error(error, tokenManager, mockClient, 1),
        ).rejects.toMatchObject({
          code: ERROR_CODES.TOKEN_EXPIRED,
        });

        expect(onLogout).toHaveBeenCalledOnce();
        expect(tokenManager.refreshToken).not.toHaveBeenCalled();
      });

      it('should call onLogout when token refresh fails', async () => {
        const refreshError = new Error('Refresh failed');
        (tokenManager.refreshToken as ReturnType<typeof vi.fn>).mockRejectedValue(refreshError);


        const error = {
          response: {
            status: 401,
            data: {
              error: {
                code: ERROR_CODES.TOKEN_EXPIRED,
                message: 'Token expired',
              },
            },
          },
          config: {
            headers: {},
            _retryCount: 0,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        await expect(
          errorHandler.handle401Error(error, tokenManager, mockClient, 1),
        ).rejects.toMatchObject({
          code: ERROR_CODES.TOKEN_EXPIRED,
          originalError: refreshError,
        });

        expect(onLogout).toHaveBeenCalledOnce();
        expect(mockClient.request).not.toHaveBeenCalled();
      });
    });

    describe('other 401 errors', () => {
      it('should reject with original error', async () => {
        const error = {
          response: {
            status: 401,
            data: {
              error: {
                code: ERROR_CODES.AUTH_FAILED,
                message: 'Authentication failed',
              },
            },
          },
        } as AxiosError;

        await expect(
          errorHandler.handle401Error(error, tokenManager, mockClient, 1),
        ).rejects.toBe(error);

        expect(onLogout).not.toHaveBeenCalled();
        expect(tokenManager.refreshToken).not.toHaveBeenCalled();
      });
    });
  });
});

