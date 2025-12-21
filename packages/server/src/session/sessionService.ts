import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SessionCache } from './sessionCache.js';
import { FirestoreSync } from './firestoreSync.js';
import type { SessionInfo, FirestoreSessionDocument, FirestoreTimestamp } from '@rapidraptor/auth-shared';
import { DEFAULTS } from '@rapidraptor/auth-shared';

/**
 * Main session management service
 * Orchestrates cache and Firestore with cache-first strategy
 */
export class SessionService {
  private cache: SessionCache;
  private firestoreSync: FirestoreSync;
  private firestore: Firestore;
  private inactivityTimeout: number;
  private collectionName: string;

  constructor(
    cache: SessionCache,
    firestoreSync: FirestoreSync,
    firestore: Firestore,
    inactivityTimeout: number,
    collectionName: string = DEFAULTS.FIRESTORE_COLLECTION_NAME,
  ) {
    this.cache = cache;
    this.firestoreSync = firestoreSync;
    this.firestore = firestore;
    this.inactivityTimeout = inactivityTimeout;
    this.collectionName = collectionName;
  }

  /**
   * Check session validity (cache-first lookup with Firestore fallback)
   */
  async isSessionValid(userId: string): Promise<boolean> {
    // Check cache first
    const cachedSession = this.cache.get(userId);
    
    // Step 1: Check for userId mismatch (data integrity issue)
    if (cachedSession && cachedSession.userId !== userId) {
      // Data integrity issue - invalidate cache entry
      this.cache.clear(userId);
      return false;
    }
    
    // Step 2: Check if cached session is valid
    if (cachedSession && !this.cache.isExpired(userId)) {
      // Cached session is valid and userId matches
      return true;
    }

    // Cache miss or expired - check Firestore
    const docRef = this.firestore.collection(this.collectionName).doc(userId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return false;
    }

    // Parse Firestore document
    const data = doc.data() as FirestoreSessionDocument;
    const session = this.parseFirestoreDocument(data);

    // Verify session userId matches requested userId (data integrity check)
    if (session.userId !== userId) {
      // Data integrity issue - session document userId doesn't match document ID
      return false;
    }

    // Check expiration
    if (new Date() > session.expiresAt) {
      return false;
    }

    // Update cache
    this.cache.set(userId, session);
    return true;
  }

  /**
   * Check if session exists in Firestore (regardless of expiration)
   * Also verifies data integrity (userId in document matches document ID)
   */
  async sessionExists(userId: string): Promise<boolean> {
    const docRef = this.firestore.collection(this.collectionName).doc(userId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return false;
    }

    // Verify session userId matches requested userId (data integrity check)
    const data = doc.data() as FirestoreSessionDocument;
    return data.userId === userId;
  }

  /**
   * Ensure session exists (idempotent - creates if doesn't exist)
   * Returns true if session was created, false if it already existed and is valid
   * Handles data integrity issues and expired sessions by overwriting with a new session
   */
  async ensureSession(userId: string): Promise<boolean> {
    // Check if session is already valid
    const isValid = await this.isSessionValid(userId);
    
    if (isValid) {
      return false; // Session already existed and is valid
    }

    // Session doesn't exist or is invalid - create/overwrite it
    // createSession is idempotent (uses set() which overwrites)
    await this.createSession(userId);
    return true; // Session was created
  }

  /**
   * Create new session
   */
  async createSession(userId: string): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.inactivityTimeout);

    const session: SessionInfo = {
      userId,
      createdAt: now,
      lastActivityAt: now,
      expiresAt,
    };

    // Update cache immediately
    this.cache.set(userId, session);

    // Write to Firestore immediately (no throttle on creation)
    const docRef = this.firestore.collection(this.collectionName).doc(userId);
    await docRef.set(this.toFirestoreDocument(session));
  }

  /**
   * Update last activity timestamp
   * Cache is updated immediately for fast reads, but Firestore write is throttled
   */
  async updateLastActivity(userId: string): Promise<void> {
    // Load and validate session (handles cache + Firestore fallback)
    const isValid = await this.isSessionValid(userId);
    if (!isValid) {
      return; // Session doesn't exist or is expired
    }

    // Session is guaranteed to be in cache and valid at this point
    const session = this.cache.get(userId);
    if (!session) {
      // Should not happen, but handle gracefully
      return;
    }

    // Update cache immediately (fast path)
    const updatedSession: SessionInfo = {
      ...session,
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + this.inactivityTimeout),
    };
    this.cache.set(userId, updatedSession);

    // Queue Firestore write (throttled - may not write immediately)
    this.firestoreSync.queueWrite(userId, updatedSession);
  }

  /**
   * Clear session (logout)
   */
  async clearSession(userId: string): Promise<void> {
    // Clear cache
    this.cache.clear(userId);

    // Delete from Firestore
    const docRef = this.firestore.collection(this.collectionName).doc(userId);
    await docRef.delete();
  }

  /**
   * Warmup cache from Firestore
   * Loads all active sessions into cache on startup
   */
  async warmupCache(): Promise<void> {
    const collection = this.firestore.collection(this.collectionName);
    const now = new Date();

    // Query active sessions
    const snapshot = await collection.where('expiresAt', '>', now).get();

    // Load into cache
    for (const doc of snapshot.docs) {
      const data = doc.data() as FirestoreSessionDocument;
      
      // SECURITY: Verify session userId matches document ID (data integrity check)
      // Skip sessions with mismatched userId (data corruption)
      if (data.userId !== doc.id) {
        console.warn(
          `Skipping session with mismatched userId: document ID=${doc.id}, data.userId=${data.userId}`,
        );
        continue;
      }
      
      const session = this.parseFirestoreDocument(data);
      this.cache.set(session.userId, session);
    }
  }

  /**
   * Parse Firestore document data into SessionInfo
   */
  private parseFirestoreDocument(data: FirestoreSessionDocument): SessionInfo {
    return {
      userId: data.userId,
      createdAt: this.toDate(data.createdAt),
      lastActivityAt: this.toDate(data.lastActivityAt),
      expiresAt: this.toDate(data.expiresAt),
    };
  }

  /**
   * Convert SessionInfo to Firestore document format
   */
  private toFirestoreDocument(session: SessionInfo): FirestoreSessionDocument {
    return {
      userId: session.userId,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Convert Firestore Timestamp to JavaScript Date
   */
  private toDate(timestamp: Timestamp | FirestoreTimestamp | Date): Date {
    if (timestamp instanceof Date) {
      return timestamp;
    }
    return timestamp.toDate();
  }
}

