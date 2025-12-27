import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionService, TokenRevokedError } from './sessionService.js';
import { SessionCache } from './sessionCache.js';
import { FirestoreSync } from './firestoreSync.js';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import type { SessionInfo } from '@rapidraptor/auth-shared';
import { SessionValidationStatus } from '@rapidraptor/auth-shared';

describe('SessionService', () => {
  let sessionService: SessionService;
  let cache: SessionCache;
  let firestoreSync: FirestoreSync;
  let mockFirestore: Firestore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockCollection: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDoc: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLogoutsCollection: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLogoutDoc: any;
  const inactivityTimeout = 24 * 60 * 60 * 1000; // 24 hours

  beforeEach(() => {
    cache = new SessionCache(inactivityTimeout);

    // Create a proper mock Firestore with batch method
    const mockBatch = {
      set: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };

    const mockFirestoreWithBatch = {
      collection: vi.fn(),
      batch: vi.fn(() => mockBatch),
    } as any;

    firestoreSync = new FirestoreSync(mockFirestoreWithBatch, 5 * 60 * 1000, 'user_sessions');

    mockDoc = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    };

    mockCollection = {
      doc: vi.fn(() => mockDoc),
      where: vi.fn(() => ({
        get: vi.fn(),
      })),
    };

    mockLogoutDoc = {
      get: vi.fn(),
      set: vi.fn(),
    };

    mockLogoutsCollection = {
      doc: vi.fn(() => mockLogoutDoc),
    };

    mockFirestore = {
      collection: vi.fn((collectionName: string) => {
        if (collectionName === 'user_logouts') {
          return mockLogoutsCollection;
        }
        return mockCollection;
      }),
      runTransaction: vi.fn(),
    } as any;

    sessionService = new SessionService(
      cache,
      firestoreSync,
      mockFirestore,
      inactivityTimeout,
    );
  });

  describe('validateSession', () => {
    it('should return VALID for valid cached session', async () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      cache.set('user1', session);

      const status = await sessionService.validateSession('user1');
      expect(status).toBe(SessionValidationStatus.VALID);
      expect(mockFirestore.collection).not.toHaveBeenCalled();
    });

    it('should return EXPIRED for expired cached session and check Firestore', async () => {
      const expiredSession: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(Date.now() - inactivityTimeout),
        lastActivityAt: new Date(Date.now() - inactivityTimeout),
        expiresAt: new Date(Date.now() - 1000),
      };
      cache.set('user1', expiredSession);

      mockDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user1',
          createdAt: { toDate: () => expiredSession.createdAt },
          lastActivityAt: { toDate: () => expiredSession.lastActivityAt },
          expiresAt: { toDate: () => expiredSession.expiresAt },
        }),
      });

      const status = await sessionService.validateSession('user1');
      expect(status).toBe(SessionValidationStatus.EXPIRED);
    });

    it('should return NOT_FOUND when Firestore document does not exist', async () => {
      mockDoc.get.mockResolvedValue({
        exists: false,
      });

      const status = await sessionService.validateSession('user1');
      expect(status).toBe(SessionValidationStatus.NOT_FOUND);
    });

    it('should return VALID when Firestore document exists and is not expired', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + inactivityTimeout);
      const firestoreTimestamp = {
        toDate: () => now,
      } as Timestamp;

      mockDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user1',
          createdAt: firestoreTimestamp,
          lastActivityAt: firestoreTimestamp,
          expiresAt: { toDate: () => expiresAt },
        }),
      });

      const status = await sessionService.validateSession('user1');
      expect(status).toBe(SessionValidationStatus.VALID);
      expect(cache.get('user1')).toBeTruthy();
    });

    it('should return EXPIRED when Firestore document exists but is expired', async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 1000);
      const firestoreTimestamp = {
        toDate: () => expiredTime,
      } as Timestamp;

      mockDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user1',
          createdAt: firestoreTimestamp,
          lastActivityAt: firestoreTimestamp,
          expiresAt: { toDate: () => expiredTime },
        }),
      });

      const status = await sessionService.validateSession('user1');
      expect(status).toBe(SessionValidationStatus.EXPIRED);
    });

    it('should return DATA_INTEGRITY_ERROR when cached session userId mismatch', async () => {
      const session: SessionInfo = {
        userId: 'user2', // Mismatch
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      cache.set('user1', session);

      const status = await sessionService.validateSession('user1');
      expect(status).toBe(SessionValidationStatus.DATA_INTEGRITY_ERROR);
      expect(cache.get('user1')).toBeNull(); // Should be cleared
    });

    it('should return DATA_INTEGRITY_ERROR when Firestore document userId mismatch', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + inactivityTimeout);
      const firestoreTimestamp = {
        toDate: () => now,
      } as Timestamp;

      mockDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user2', // Mismatch with document ID
          createdAt: firestoreTimestamp,
          lastActivityAt: firestoreTimestamp,
          expiresAt: { toDate: () => expiresAt },
        }),
      });

      const status = await sessionService.validateSession('user1');
      expect(status).toBe(SessionValidationStatus.DATA_INTEGRITY_ERROR);
    });
  });

  describe('isSessionValid', () => {
    it('should return true for valid session', async () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      cache.set('user1', session);

      const isValid = await sessionService.isSessionValid('user1');
      expect(isValid).toBe(true);
    });

    it('should return false for invalid session', async () => {
      mockDoc.get.mockResolvedValue({
        exists: false,
      });

      const isValid = await sessionService.isSessionValid('user1');
      expect(isValid).toBe(false);
    });
  });

  describe('ensureSession', () => {
    it('should create new session if it does not exist', async () => {
      // Mock Firestore to return no document (session doesn't exist)
      mockDoc.get.mockResolvedValue({
        exists: false,
      });

      const wasCreated = await sessionService.ensureSession('user1');
      expect(wasCreated).toBe(true);
      expect(cache.get('user1')).toBeTruthy();
      expect(mockDoc.set).toHaveBeenCalled();
    });

    it('should return false if session already exists and is valid', async () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      // Set valid session in cache
      cache.set('user1', session);

      const wasCreated = await sessionService.ensureSession('user1');
      expect(wasCreated).toBe(false);
      expect(mockDoc.set).not.toHaveBeenCalled();
    });

    it('should throw error if session exists but is expired', async () => {
      const expiredSession: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(Date.now() - inactivityTimeout),
        lastActivityAt: new Date(Date.now() - inactivityTimeout),
        expiresAt: new Date(Date.now() - 1000),
      };
      // Set expired session in cache
      cache.set('user1', expiredSession);

      // Mock Firestore to return expired session
      mockDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user1',
          createdAt: { toDate: () => expiredSession.createdAt },
          lastActivityAt: { toDate: () => expiredSession.lastActivityAt },
          expiresAt: { toDate: () => expiredSession.expiresAt },
        }),
      });

      await expect(sessionService.ensureSession('user1')).rejects.toThrow(
        'Session has expired. Please logout and login again.',
      );
      // Verify session was NOT recreated
      expect(mockDoc.set).not.toHaveBeenCalled();
    });

    it('should recreate session if data integrity issue detected (userId mismatch)', async () => {
      // Mock Firestore to return document with mismatched userId
      mockDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'different-user', // Mismatch with document ID
          createdAt: { toDate: () => new Date() },
          lastActivityAt: { toDate: () => new Date() },
          expiresAt: { toDate: () => new Date(Date.now() + inactivityTimeout) },
        }),
      });

      const wasCreated = await sessionService.ensureSession('user1');
      expect(wasCreated).toBe(true);
      expect(cache.get('user1')).toBeTruthy();
      // Verify new session was created with correct userId
      const newSession = cache.get('user1');
      expect(newSession!.userId).toBe('user1');
      expect(mockDoc.set).toHaveBeenCalled();
    });

    it('should throw error if token was issued before logout', async () => {
      // Mock logout record exists
      const loggedOutAt = new Date();
      const tokenIssuedAt = new Date(loggedOutAt.getTime() - 1000); // 1 second before logout

      mockLogoutDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user1',
          loggedOutAt: { toDate: () => loggedOutAt },
          expiresAt: { toDate: () => new Date(loggedOutAt.getTime() + 3600000) }, // 1 hour TTL, still valid
        }),
      });

      // Mock Firestore to return no document (session doesn't exist)
      mockDoc.get.mockResolvedValue({
        exists: false,
      });

      await expect(sessionService.ensureSession('user1', tokenIssuedAt)).rejects.toThrow(
        TokenRevokedError,
      );
      expect(mockDoc.set).not.toHaveBeenCalled();
    });

    it('should create session if token was issued after logout', async () => {
      // Mock logout record exists but token was issued after
      const loggedOutAt = new Date();
      const tokenIssuedAt = new Date(loggedOutAt.getTime() + 1000); // 1 second after logout

      mockLogoutDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user1',
          loggedOutAt: { toDate: () => loggedOutAt },
          expiresAt: { toDate: () => new Date(loggedOutAt.getTime() + 3600000) }, // 1 hour TTL, still valid
        }),
      });

      // Mock Firestore to return no document (session doesn't exist)
      mockDoc.get.mockResolvedValue({
        exists: false,
      });

      const wasCreated = await sessionService.ensureSession('user1', tokenIssuedAt);
      expect(wasCreated).toBe(true);
      expect(cache.get('user1')).toBeTruthy();
      expect(mockDoc.set).toHaveBeenCalled();
    });

    it('should work without tokenIssuedAt parameter (backward compatibility)', async () => {
      // Mock Firestore to return no document (session doesn't exist)
      mockDoc.get.mockResolvedValue({
        exists: false,
      });

      const wasCreated = await sessionService.ensureSession('user1');
      expect(wasCreated).toBe(true);
      expect(cache.get('user1')).toBeTruthy();
      expect(mockDoc.set).toHaveBeenCalled();
    });
  });

  describe('updateLastActivity', () => {
    it('should update cache immediately and queue Firestore write', async () => {
      const originalTime = new Date(Date.now() - 1000); // Set time 1 second ago
      const originalExpiresAt = new Date(Date.now() + inactivityTimeout); // Set expiresAt in the future (valid)
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: originalTime,
        lastActivityAt: originalTime,
        expiresAt: originalExpiresAt,
      };
      cache.set('user1', session);

      const queueWriteSpy = vi.spyOn(firestoreSync, 'queueWrite');

      await sessionService.updateLastActivity('user1');

      const updatedSession = cache.get('user1');
      expect(updatedSession).toBeTruthy();
      // Verify that lastActivityAt was updated (should be more recent)
      expect(updatedSession!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(originalTime.getTime());
      // Verify expiresAt was also updated (should be in the future now)
      expect(updatedSession!.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(updatedSession!.expiresAt.getTime()).toBeGreaterThanOrEqual(originalExpiresAt.getTime());
      expect(queueWriteSpy).toHaveBeenCalled();
    });

    it('should load session from Firestore if not in cache', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + inactivityTimeout);

      mockDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user1',
          createdAt: { toDate: () => now },
          lastActivityAt: { toDate: () => now },
          expiresAt: { toDate: () => expiresAt },
        }),
      });

      const queueWriteSpy = vi.spyOn(firestoreSync, 'queueWrite');

      await sessionService.updateLastActivity('user1');

      expect(cache.get('user1')).toBeTruthy();
      // Verify the session was loaded and updated
      const updatedSession = cache.get('user1');
      expect(updatedSession).toBeTruthy();
      expect(updatedSession!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
      expect(queueWriteSpy).toHaveBeenCalled();
    });
  });

  describe('clearSession', () => {
    it('should clear cache, store logout timestamp, and delete from Firestore', async () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      cache.set('user1', session);

      await sessionService.clearSession('user1');

      expect(cache.get('user1')).toBeNull();
      expect(mockDoc.delete).toHaveBeenCalled();
      // Verify logout timestamp was stored
      expect(mockFirestore.collection).toHaveBeenCalledWith('user_logouts');
      expect(mockLogoutDoc.set).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user1',
          loggedOutAt: expect.any(Date),
          expiresAt: expect.any(Date),
        }),
      );
    });
  });

  describe('wasTokenIssuedBeforeLogout', () => {
    it('should return false if no logout record exists', async () => {
      mockLogoutDoc.get.mockResolvedValue({
        exists: false,
      });

      const tokenIssuedAt = new Date();
      const wasIssuedBeforeLogout = await sessionService.wasTokenIssuedBeforeLogout('user1', tokenIssuedAt);

      expect(wasIssuedBeforeLogout).toBe(false);
    });

    it('should still check token validity even if logout record has expired (TTL is only for cleanup)', async () => {
      const loggedOutAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const tokenIssuedAt = new Date(loggedOutAt.getTime() - 1000); // 1 second before logout

      // Logout record exists but has expired (for cleanup purposes)
      mockLogoutDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user1',
          loggedOutAt: { toDate: () => loggedOutAt },
          expiresAt: { toDate: () => new Date(loggedOutAt.getTime() + 3600000) }, // 1 hour TTL, expired
        }),
      });

      // Token was issued before logout, so it should be rejected even though logout record expired
      const wasIssuedBeforeLogout = await sessionService.wasTokenIssuedBeforeLogout('user1', tokenIssuedAt);

      expect(wasIssuedBeforeLogout).toBe(true);
    });

    it('should return true if token was issued before logout', async () => {
      const loggedOutAt = new Date();
      const tokenIssuedAt = new Date(loggedOutAt.getTime() - 1000); // 1 second before logout

      mockLogoutDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user1',
          loggedOutAt: { toDate: () => loggedOutAt },
          expiresAt: { toDate: () => new Date(loggedOutAt.getTime() + 3600000) }, // 1 hour TTL, still valid
        }),
      });

      const wasIssuedBeforeLogout = await sessionService.wasTokenIssuedBeforeLogout('user1', tokenIssuedAt);

      expect(wasIssuedBeforeLogout).toBe(true);
    });

    it('should return false if token was issued after logout', async () => {
      const loggedOutAt = new Date();
      const tokenIssuedAt = new Date(loggedOutAt.getTime() + 1000); // 1 second after logout

      mockLogoutDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({
          userId: 'user1',
          loggedOutAt: { toDate: () => loggedOutAt },
          expiresAt: { toDate: () => new Date(loggedOutAt.getTime() + 3600000) }, // 1 hour TTL, still valid
        }),
      });

      const wasIssuedBeforeLogout = await sessionService.wasTokenIssuedBeforeLogout('user1', tokenIssuedAt);

      expect(wasIssuedBeforeLogout).toBe(false);
    });
  });
});

