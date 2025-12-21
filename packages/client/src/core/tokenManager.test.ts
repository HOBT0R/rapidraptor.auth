import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenManager } from './tokenManager.js';
import type { FirebaseAuth, FirebaseUser } from '@rapidraptor/auth-shared';

describe('TokenManager', () => {
  let tokenManager: TokenManager;
  let mockAuth: FirebaseAuth;
  let mockUser: FirebaseUser;

  beforeEach(() => {
    mockUser = {
      getIdToken: vi.fn<[boolean?], Promise<string>>(),
    };

    // Use a getter/setter to allow changing currentUser in tests
    let currentUserValue: FirebaseUser | null = mockUser;
    mockAuth = {
      get currentUser() {
        return currentUserValue;
      },
      set currentUser(value: FirebaseUser | null) {
        currentUserValue = value;
      },
    } as FirebaseAuth & { currentUser: FirebaseUser | null };

    tokenManager = new TokenManager(mockAuth);
  });

  describe('getToken', () => {
    it('should return null when no user is authenticated', async () => {
      (mockAuth as any).currentUser = null;
      const token = await tokenManager.getToken();
      expect(token).toBeNull();
    });

    it('should get token from current user', async () => {
      const expectedToken = 'test-token';
      (mockUser.getIdToken as ReturnType<typeof vi.fn>).mockResolvedValue(expectedToken);

      const token = await tokenManager.getToken();
      expect(token).toBe(expectedToken);
      expect(mockUser.getIdToken).toHaveBeenCalledWith(false);
    });

    it('should force refresh when requested', async () => {
      const expectedToken = 'refreshed-token';
      (mockUser.getIdToken as ReturnType<typeof vi.fn>).mockResolvedValue(expectedToken);

      const token = await tokenManager.getToken(true);
      expect(token).toBe(expectedToken);
      expect(mockUser.getIdToken).toHaveBeenCalledWith(true);
    });
  });

  describe('refreshToken', () => {
    it('should refresh token and return new token', async () => {
      const newToken = 'new-token';
      (mockUser.getIdToken as ReturnType<typeof vi.fn>).mockResolvedValue(newToken);

      const token = await tokenManager.refreshToken();
      expect(token).toBe(newToken);
      expect(mockUser.getIdToken).toHaveBeenCalledWith(true);
    });

    it('should throw error when no user is authenticated', async () => {
      (mockAuth as any).currentUser = null;

      await expect(tokenManager.refreshToken()).rejects.toThrow('No user authenticated');
    });

    it('should handle concurrent refresh requests', async () => {
      const newToken = 'new-token';
      (mockUser.getIdToken as ReturnType<typeof vi.fn>).mockResolvedValue(newToken);

      // Start two concurrent refresh requests
      const promise1 = tokenManager.refreshToken();
      const promise2 = tokenManager.refreshToken();

      const [token1, token2] = await Promise.all([promise1, promise2]);

      // Both should get the same token
      expect(token1).toBe(newToken);
      expect(token2).toBe(newToken);
      // getIdToken should only be called once (not twice)
      expect(mockUser.getIdToken).toHaveBeenCalledTimes(1);
    });

    it('should clear refresh promise after completion', async () => {
      const newToken = 'new-token';
      (mockUser.getIdToken as ReturnType<typeof vi.fn>).mockResolvedValue(newToken);

      await tokenManager.refreshToken();
      // Second call should trigger a new refresh
      await tokenManager.refreshToken();

      expect(mockUser.getIdToken).toHaveBeenCalledTimes(2);
    });

    it('should clear refresh promise after error', async () => {
      const error = new Error('Refresh failed');
      (mockUser.getIdToken as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      await expect(tokenManager.refreshToken()).rejects.toThrow('Refresh failed');
      // Second call should trigger a new refresh attempt
      (mockUser.getIdToken as ReturnType<typeof vi.fn>).mockResolvedValue('new-token');
      const token = await tokenManager.refreshToken();
      expect(token).toBe('new-token');
      expect(mockUser.getIdToken).toHaveBeenCalledTimes(2);
    });
  });
});

