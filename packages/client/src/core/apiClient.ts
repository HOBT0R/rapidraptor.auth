import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

import { DEFAULTS } from '@rapidraptor/auth-shared';
import type { ApiClientConfig } from '@rapidraptor/auth-shared';

import { ErrorHandler } from './errorHandler.js';
import { TokenManager } from './tokenManager.js';

/**
 * Create API client with automatic token injection and error handling
 */
export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const {
    baseURL,
    auth,
    onLogout,
    maxRetries = DEFAULTS.MAX_RETRIES,
    timeout = DEFAULTS.API_TIMEOUT_MS,
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

  return client;
}

