import type { Firestore } from 'firebase-admin/firestore';
import type { SessionInfo } from '@rapidraptor/auth-shared';
import { DEFAULTS } from '@rapidraptor/auth-shared';
import type { SessionMap } from '../types/session.js';

/**
 * Firestore sync service with throttled batch writes
 * All writes are queued and processed at fixed intervals
 */
export class FirestoreSync {
  private firestore: Firestore;
  private writeQueue: SessionMap;
  private throttleMs: number;
  private batchSyncInterval: NodeJS.Timeout | null = null;
  private collectionName: string;

  constructor(
    firestore: Firestore,
    throttleMs: number,
    collectionName: string = DEFAULTS.FIRESTORE_SESSIONS_COLLECTION_NAME,
  ) {
    this.firestore = firestore;
    this.writeQueue = new Map();
    this.throttleMs = throttleMs;
    this.collectionName = collectionName;
  }

  /**
   * Queue write for batch processing
   * Writes are processed at fixed intervals (throttleMs)
   */
  queueWrite(userId: string, session: SessionInfo): void {
    // Always update the queue with latest session data
    // Latest write wins if multiple updates for same user
    this.writeQueue.set(userId, session);
  }

  /**
   * Batch sync all queued writes to Firestore
   */
  async batchSync(): Promise<void> {
    if (this.getPendingWriteCount() === 0) {
      return;
    }

    // Create Firestore batch
    const batch = this.firestore.batch();
    const collection = this.firestore.collection(this.collectionName);

    // Add all queued writes to batch (document ID = sessionId)
    for (const [, session] of this.writeQueue.entries()) {
      const docRef = collection.doc(session.sessionId);
      batch.set(
        docRef,
        {
          sessionId: session.sessionId,
          userId: session.userId,
          createdAt: session.createdAt,
          lastActivityAt: session.lastActivityAt,
          expiresAt: session.expiresAt,
        },
        { merge: false },
      );
    }

    try {
      // Commit batch write
      await batch.commit();

      // Clear queue after successful write
      this.writeQueue.clear();
    } catch (error) {
      console.error('Failed to batch sync to Firestore:', error);
      throw error;
    }
  }

  /**
   * Start periodic batch sync
   * Processes queued writes every throttleMs milliseconds
   */
  startPeriodicSync(): void {
    if (this.batchSyncInterval) {
      return; // Already started
    }

    this.batchSyncInterval = setInterval(() => {
      this.batchSync().catch((err) => {
        console.error('Periodic batch sync failed:', err);
      });
    }, this.throttleMs);
  }

  /**
   * Stop periodic batch sync
   */
  stopPeriodicSync(): void {
    if (this.batchSyncInterval) {
      clearInterval(this.batchSyncInterval);
      this.batchSyncInterval = null;
    }
  }

  /**
   * Get pending write count
   */
  getPendingWriteCount(): number {
    return this.writeQueue.size;
  }
}

