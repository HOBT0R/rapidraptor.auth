import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FirestoreSync } from './firestoreSync.js';
import type { Firestore } from 'firebase-admin/firestore';
import type { SessionInfo } from '@rapidraptor/auth-shared';

describe('FirestoreSync', () => {
  let firestoreSync: FirestoreSync;
  let mockFirestore: Firestore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockBatch: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockCollection: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDoc: any;
  const throttleMs = 5 * 60 * 1000; // 5 minutes

  beforeEach(() => {
    mockDoc = {
      set: vi.fn(),
    };

    mockCollection = {
      doc: vi.fn(() => mockDoc),
    };

    mockBatch = {
      set: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };


    mockFirestore = {
      collection: vi.fn(() => mockCollection),
      batch: vi.fn(() => mockBatch),
    } as any;

    firestoreSync = new FirestoreSync(mockFirestore, throttleMs, 'user_sessions');
  });

  afterEach(() => {
    firestoreSync.stopPeriodicSync();
  });

  describe('queueWrite', () => {
    it('should queue writes for batch processing', () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      firestoreSync.queueWrite('user1', session);
      expect(firestoreSync.getPendingWriteCount()).toBe(1);
    });

    it('should update existing queue entry with latest session data', () => {
      const session1: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      const session2: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(Date.now() + 1000),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      firestoreSync.queueWrite('user1', session1);
      firestoreSync.queueWrite('user1', session2); // Update same user

      // Should still be 1 (updated, not added)
      expect(firestoreSync.getPendingWriteCount()).toBe(1);
    });
  });

  describe('batchSync', () => {
    it('should sync all queued writes to Firestore', async () => {
      const session1: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      const session2: SessionInfo = {
        userId: 'user2',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      firestoreSync.queueWrite('user1', session1);
      firestoreSync.queueWrite('user2', session2);

      // Reset mocks before batchSync
      vi.clearAllMocks();

      await firestoreSync.batchSync();

      expect(mockFirestore.collection).toHaveBeenCalledWith('user_sessions');
      expect(mockCollection.doc).toHaveBeenCalledWith('user1');
      expect(mockCollection.doc).toHaveBeenCalledWith('user2');
      expect(mockBatch.set).toHaveBeenCalledTimes(2);
      expect(mockBatch.commit).toHaveBeenCalledOnce();
      expect(firestoreSync.getPendingWriteCount()).toBe(0);
    });

    it('should do nothing if queue is empty', async () => {
      await firestoreSync.batchSync();
      expect(mockFirestore.batch).not.toHaveBeenCalled();
    });

    it('should handle Firestore errors', async () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      firestoreSync.queueWrite('user1', session);
      mockBatch.commit.mockRejectedValueOnce(new Error('Firestore error'));

      await expect(firestoreSync.batchSync()).rejects.toThrow('Firestore error');
    });
  });

  describe('periodic sync', () => {
    it('should start periodic sync using throttleMs', () => {
      firestoreSync.startPeriodicSync();
      expect(firestoreSync.getPendingWriteCount()).toBe(0);
      firestoreSync.stopPeriodicSync();
    });

    it('should stop periodic sync', () => {
      firestoreSync.startPeriodicSync();
      firestoreSync.stopPeriodicSync();
      // Should not throw
      expect(true).toBe(true);
    });

    it('should not start multiple intervals', () => {
      firestoreSync.startPeriodicSync();
      const interval1 = (firestoreSync as any).batchSyncInterval;
      firestoreSync.startPeriodicSync(); // Try to start again
      const interval2 = (firestoreSync as any).batchSyncInterval;
      expect(interval1).toBe(interval2); // Should be the same
      firestoreSync.stopPeriodicSync();
    });
  });

  describe('getPendingWriteCount', () => {
    it('should return 0 for empty queue', () => {
      expect(firestoreSync.getPendingWriteCount()).toBe(0);
    });

    it('should return correct count', () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      firestoreSync.queueWrite('user1', session);
      expect(firestoreSync.getPendingWriteCount()).toBe(1);
    });
  });
});

