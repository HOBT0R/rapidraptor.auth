import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { SessionCache } from './sessionCache.js';
import { FirestoreSync } from './firestoreSync.js';
import type {
  SessionInfo,
  FirestoreSessionDocument,
  FirestoreLogoutDocument,
  FirestoreTimestamp,
} from '@rapidraptor/auth-shared';
import { SessionValidationStatus } from '@rapidraptor/auth-shared';
import { DEFAULTS } from '@rapidraptor/auth-shared';

/**
 * Error thrown when attempting to create a session with a revoked token
 */
export class TokenRevokedError extends Error {
  constructor() {
    super('Token was issued before logout');
    this.name = 'TokenRevokedError';
  }
}

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
  private logoutsCollectionName: string;
  private logoutTtlMs: number;

  constructor(
    cache: SessionCache,
    firestoreSync: FirestoreSync,
    firestore: Firestore,
    inactivityTimeout: number,
    collectionName: string = DEFAULTS.FIRESTORE_SESSIONS_COLLECTION_NAME,
    logoutsCollectionName: string = DEFAULTS.FIRESTORE_LOGOUTS_COLLECTION_NAME,
    logoutTtlMs: number = DEFAULTS.LOGOUT_TTL_MS,
  ) {
    this.cache = cache;
    this.firestoreSync = firestoreSync;
    this.firestore = firestore;
    this.inactivityTimeout = inactivityTimeout;
    this.collectionName = collectionName;
    this.logoutsCollectionName = logoutsCollectionName;
    this.logoutTtlMs = logoutTtlMs;
  }

  /**
   * Validate session and return detailed status (cache-first lookup with Firestore fallback)
   * Returns explicit status instead of boolean to avoid requiring additional calls
   * to determine why a session is invalid
   */
  async validateSession(userId: string): Promise<SessionValidationStatus> {
    // Check cache first
    const cachedSession = this.cache.get(userId);
    
    // Step 1: Check for userId mismatch (data integrity issue)
    if (cachedSession && cachedSession.userId !== userId) {
      // Data integrity issue - invalidate cache entry
      this.cache.clear(userId);
      return SessionValidationStatus.DATA_INTEGRITY_ERROR;
    }
    
    // Step 2: Check if cached session is valid
    if (cachedSession && !this.cache.isExpired(userId)) {
      // Cached session is valid and userId matches
      return SessionValidationStatus.VALID;
    }

    // Cache miss or expired - check Firestore
    const docRef = this.firestore.collection(this.collectionName).doc(userId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return SessionValidationStatus.NOT_FOUND;
    }

    // Parse Firestore document
    const data = doc.data() as FirestoreSessionDocument;
    const session = this.parseFirestoreDocument(data);

    // Verify session userId matches requested userId (data integrity check)
    if (session.userId !== userId) {
      // Data integrity issue - session document userId doesn't match document ID
      return SessionValidationStatus.DATA_INTEGRITY_ERROR;
    }

    // Check expiration
    if (new Date() > session.expiresAt) {
      return SessionValidationStatus.EXPIRED;
    }

    // Update cache
    this.cache.set(userId, session);
    return SessionValidationStatus.VALID;
  }

  /**
   * Check session validity (cache-first lookup with Firestore fallback)
   * @deprecated Use validateSession() instead for more detailed status information
   */
  async isSessionValid(userId: string): Promise<boolean> {
    const status = await this.validateSession(userId);
    return status === SessionValidationStatus.VALID;
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
   * Handles data integrity issues by overwriting with a new session
   * 
   * @param userId - The user ID
   * @param tokenIssuedAt - Optional JWT token issued-at timestamp for revocation check
   * @throws TokenRevokedError if token was issued before logout (when tokenIssuedAt is provided)
   * @throws Error if session is expired (user must logout and login again)
   */
  async ensureSession(userId: string, tokenIssuedAt?: Date): Promise<boolean> {
    // Check if token was issued before logout (if tokenIssuedAt provided)
    if (tokenIssuedAt) {
      const wasIssuedBeforeLogout = await this.wasTokenIssuedBeforeLogout(userId, tokenIssuedAt);
      if (wasIssuedBeforeLogout) {
        throw new TokenRevokedError();
      }
    }

    // Check session validation status
    const status = await this.validateSession(userId);
    
    if (status === SessionValidationStatus.VALID) {
      return false; // Session already existed and is valid
    }

    // If session is expired, don't recreate it - user must logout and relogin
    if (status === SessionValidationStatus.EXPIRED) {
      throw new Error('Session has expired. Please logout and login again.');
    }

    // Session doesn't exist (NOT_FOUND) or has data integrity issues - create/overwrite it
    // Note: For DATA_INTEGRITY_ERROR, we recreate the session to fix the corruption
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
   * Also stores logout timestamp to prevent re-authentication with JWTs issued before logout
   */
  async clearSession(userId: string): Promise<void> {
    // Clear cache
    this.cache.clear(userId);

    // Store logout timestamp to prevent re-authentication with old JWTs
    // This addresses the JWT limitation: JWTs cannot be revoked, but we can track
    // when a user logged out and reject tokens issued before that time
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.logoutTtlMs);

    const logoutRef = this.firestore.collection(this.logoutsCollectionName).doc(userId);
    await logoutRef.set(
      this.toLogoutDocument({
        userId,
        loggedOutAt: now,
        expiresAt,
      }),
    );

    // Delete session document from Firestore
    const docRef = this.firestore.collection(this.collectionName).doc(userId);
    await docRef.delete();
  }

  /**
   * Check if JWT token was issued before logout
   * Returns true if token was issued before logout timestamp
   */
  async wasTokenIssuedBeforeLogout(userId: string, tokenIssuedAt: Date): Promise<boolean> {
    // Check logout timestamp
    const logoutRef = this.firestore.collection(this.logoutsCollectionName).doc(userId);
    const doc = await logoutRef.get();

    if (!doc.exists) {
      return false; // No logout recorded - token is valid
    }

    const data = doc.data() as FirestoreLogoutDocument;
    if (!data) {
      return false;
    }

    // Parse logout document
    const logoutInfo = this.parseLogoutDocument(data);

    // Check if token was issued BEFORE logout
    return tokenIssuedAt < logoutInfo.loggedOutAt;
  }

  /**
   * Warmup cache from Firestore
   * Loads all active sessions into cache on startup
   * Also cleans up expired sessions (lazy deletion)
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

    // Cleanup expired sessions (lazy deletion)
    const expiredSnapshot = await collection.where('expiresAt', '<=', now).get();
    
    if (expiredSnapshot.empty) {
      return; // No expired sessions to clean up
    }

    // Delete expired sessions in batches (Firestore batch limit is 500)
    const batchSize = 500;
    const expiredDocs = expiredSnapshot.docs;
    let deletedCount = 0;

    for (let i = 0; i < expiredDocs.length; i += batchSize) {
      const batch = this.firestore.batch();
      const batchDocs = expiredDocs.slice(i, i + batchSize);

      for (const doc of batchDocs) {
        batch.delete(doc.ref);
        deletedCount++;
      }

      await batch.commit();
    }

    if (deletedCount > 0) {
      console.info(`Cleaned up ${deletedCount} expired session(s) during cache warmup`);
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

  /**
   * Parse Firestore logout document data
   */
  private parseLogoutDocument(data: FirestoreLogoutDocument): {
    userId: string;
    loggedOutAt: Date;
    expiresAt: Date;
  } {
    return {
      userId: data.userId,
      loggedOutAt: this.toDate(data.loggedOutAt),
      expiresAt: this.toDate(data.expiresAt),
    };
  }

  /**
   * Convert logout info to Firestore document format
   */
  private toLogoutDocument(logoutInfo: {
    userId: string;
    loggedOutAt: Date;
    expiresAt: Date;
  }): FirestoreLogoutDocument {
    return {
      userId: logoutInfo.userId,
      loggedOutAt: logoutInfo.loggedOutAt,
      expiresAt: logoutInfo.expiresAt,
    };
  }
}

