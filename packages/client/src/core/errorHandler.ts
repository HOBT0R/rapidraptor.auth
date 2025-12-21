import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

import { ERROR_CODES } from '@rapidraptor/auth-shared';

import { TokenManager } from './tokenManager.js';

/**
 * Error handler for 401 responses
 * Detects SESSION_EXPIRED vs TOKEN_EXPIRED and handles appropriately
 */
export class ErrorHandler {
  private onLogout?: () => void | Promise<void>;

  constructor(onLogout?: () => void | Promise<void>) {
    this.onLogout = onLogout;
  }

  /**
   * Handle logout if callback is provided
   */
  private async performLogout(): Promise<void> {
    if (this.onLogout) {
      await this.onLogout();
    }
  }

  /**
   * Handle 401 errors
   */
  async handle401Error(
    error: AxiosError,
    tokenManager: TokenManager,
    client: AxiosInstance,
    maxRetries: number,
  ): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorData = (error.response?.data as any)?.error;

    // Step 1: Handle SESSION_EXPIRED
    if (errorData?.code === ERROR_CODES.SESSION_EXPIRED) {
      // Session expired - logout
      await this.performLogout();
      return Promise.reject({
        code: ERROR_CODES.SESSION_EXPIRED,
        sessionExpired: true,
        message: 'Session has expired',
      });
    }

    // Step 2: Handle TOKEN_EXPIRED
    if (errorData?.code !== ERROR_CODES.TOKEN_EXPIRED) {
      // Other 401 errors - reject as-is
      return Promise.reject(error);
    }

    // Token expired - refresh and retry
    // Track retry count using a custom property on the error config
    const config = error.config as InternalAxiosRequestConfig & { _retryCount?: number };
    const retryCount = config._retryCount || 0;

    // Step 3: Check if max retries exceeded
    if (retryCount >= maxRetries) {
      // Max retries exceeded - logout
      await this.performLogout();
      return Promise.reject({
        code: ERROR_CODES.TOKEN_EXPIRED,
        message: 'Token refresh failed after retries',
      });
    }

    // Step 4: Attempt token refresh and retry
    try {
      // Refresh token (may throw if refresh fails)
      const newToken = await tokenManager.refreshToken();

      // Retry original request with new token
      config._retryCount = retryCount + 1;
      if (config.headers) {
        config.headers.Authorization = `Bearer ${newToken}`;
      }
      return client.request(config);
    } catch (refreshError) {
      // Token refresh failed - logout
      await this.performLogout();
      return Promise.reject({
        code: ERROR_CODES.TOKEN_EXPIRED,
        message: 'Token refresh failed',
        originalError: refreshError,
      });
    }
  }
}

