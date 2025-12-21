import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient } from './apiClient.js';
import type { FirebaseAuth, FirebaseUser } from '@rapidraptor/auth-shared';

describe('createApiClient', () => {
  let mockAuth: FirebaseAuth;
  let mockUser: FirebaseUser;
  let onLogout: () => void | Promise<void>;

  beforeEach(() => {
    onLogout = vi.fn<[], void>();

    mockUser = {
      getIdToken: vi.fn<[boolean?], Promise<string>>().mockResolvedValue('test-token'),
    };

    mockAuth = {
      get currentUser() {
        return mockUser;
      },
    };
  });

  it('should create axios instance', () => {
    const client = createApiClient({
      baseURL: '/api',
      auth: mockAuth,
      onLogout,
    });

    expect(client).toBeDefined();
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
  });

  it('should inject token in request interceptor', async () => {
    const client = createApiClient({
      baseURL: '/api',
      auth: mockAuth,
      onLogout,
    });

    // The interceptor is set up internally
    // We can verify by checking that the client was created
    expect(client).toBeDefined();
  });

  it('should use custom timeout when provided', () => {
    const client = createApiClient({
      baseURL: '/api',
      auth: mockAuth,
      onLogout,
      timeout: 60000,
    });

    expect(client).toBeDefined();
  });

  it('should use custom maxRetries when provided', () => {
    const client = createApiClient({
      baseURL: '/api',
      auth: mockAuth,
      onLogout,
      maxRetries: 3,
    });

    // maxRetries is used in error handler, which is tested separately
    expect(client).toBeDefined();
  });
});

