import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

import { DEFAULTS } from '@rapidraptor/auth-shared';
import type { ApiClientConfig } from '@rapidraptor/auth-shared';

import { ErrorHandler } from './errorHandler.js';
import { TokenManager } from './tokenManager.js';

/**
 * Extended AxiosInstance with logout method
 */
export interface ApiClient extends AxiosInstance {
  logout: () => Promise<void>;
}

/**
 * Create API client with automatic token injection and error handling
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  const {
    baseURL,
    auth,
    onLogout,
    maxRetries = DEFAULTS.MAX_RETRIES,
    timeout = DEFAULTS.API_TIMEOUT_MS,
    logoutEndpoint = '/auth/logout',
  } = config;

  const client = axios.create({
    baseURL,
    timeout,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const tokenManager = new TokenManager(auth);
  const errorHandler = new ErrorHandler(onLogout);

  // Request interceptor - inject token
  client.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      // Get current user token
      const token = await tokenManager.getToken(false);
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    },
  );

  // Response interceptor - handle errors
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (error.response?.status === 401) {
        return errorHandler.handle401Error(error, tokenManager, client, maxRetries);
      }
      return Promise.reject(error);
    },
  );

  // Add logout method to client
  const apiClient = client as ApiClient;
  apiClient.logout = async (): Promise<void> => {
    try {
      // Attempt to clear server-side session
      // Get token for logout request
      const token = await tokenManager.getToken(false);
      if (token) {
        try {
          // Call logout endpoint to clear server session
          await client.post(
            logoutEndpoint,
            {},
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );
        } catch (error) {
          // Log but don't fail - graceful degradation
          // If server logout fails, still proceed with client-side logout
          console.warn('Failed to clear server session:', error);
        }
      }
    } catch (error) {
      // Log but don't fail - graceful degradation
      console.warn('Failed to get token for logout:', error);
    }

    // Always perform client-side logout (even if server logout failed)
    if (onLogout) {
      await onLogout();
    }
  };

  return apiClient;
}

