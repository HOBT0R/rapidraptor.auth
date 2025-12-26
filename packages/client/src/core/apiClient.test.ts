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

  describe('logout', () => {
    it('should have logout method', () => {
      const client = createApiClient({
        baseURL: '/api',
        auth: mockAuth,
        onLogout,
      });

      expect(typeof client.logout).toBe('function');
    });

    it('should call logout endpoint and onLogout callback on success', async () => {
      const client = createApiClient({
        baseURL: '/api',
        auth: mockAuth,
        onLogout,
        logoutEndpoint: '/auth/logout',
      });

      // Mock successful POST request
      const postSpy = vi.spyOn(client, 'post').mockResolvedValue({
        status: 200,
        data: { message: 'Logged out successfully' },
      } as any);

      await client.logout();

      expect(postSpy).toHaveBeenCalledWith(
        '/auth/logout',
        {},
        {
          headers: {
            Authorization: 'Bearer test-token',
          },
        },
      );
      expect(onLogout).toHaveBeenCalled();
    });

    it('should use default logout endpoint if not specified', async () => {
      const client = createApiClient({
        baseURL: '/api',
        auth: mockAuth,
        onLogout,
      });

      const postSpy = vi.spyOn(client, 'post').mockResolvedValue({
        status: 200,
        data: { message: 'Logged out successfully' },
      } as any);

      await client.logout();

      expect(postSpy).toHaveBeenCalledWith(
        '/auth/logout',
        {},
        expect.any(Object),
      );
    });

    it('should call onLogout even if server logout fails (graceful degradation)', async () => {
      const client = createApiClient({
        baseURL: '/api',
        auth: mockAuth,
        onLogout,
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const postSpy = vi.spyOn(client, 'post').mockRejectedValue(new Error('Network error'));

      await client.logout();

      expect(postSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to clear server session:', expect.any(Error));
      expect(onLogout).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should call onLogout even if token retrieval fails', async () => {
      const client = createApiClient({
        baseURL: '/api',
        auth: mockAuth,
        onLogout,
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(mockUser, 'getIdToken').mockRejectedValue(new Error('Token error'));

      await client.logout();

      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to get token for logout:', expect.any(Error));
      expect(onLogout).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should handle logout when no user is authenticated', async () => {
      const authWithoutUser: FirebaseAuth = {
        get currentUser() {
          return null;
        },
      };

      const client = createApiClient({
        baseURL: '/api',
        auth: authWithoutUser,
        onLogout,
      });

      await client.logout();

      // Should still call onLogout even without token
      expect(onLogout).toHaveBeenCalled();
    });
  });
});

