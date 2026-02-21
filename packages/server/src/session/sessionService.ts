import { randomUUID } from 'crypto';
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
 * Main session management service. Sessions are stored in Firestore as user_sessions/{sessionId}
 * (sessionId is a UUID). Lookup is by userId (from JWT sub); cache is keyed by userId.
 * Uses cache-first strategy with Firestore fallback.
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
   * Find active session for user.
   * Sessions are stored as user_sessions/{sessionId}; we query by userId (from JWT sub) since
   * sessionId is not sent by the client. orderBy lastActivityAt desc ensures a deterministic
   * result when multiple active sessions exist for the same user (e.g. race or bug).
   */
  private async findActiveSessionByUserId(userId: string): Promise<SessionInfo | null> {
    const snapshot = await this.firestore
      .collection(this.collectionName)
      .where('userId', '==', userId)
      .where('expiresAt', '>', new Date())
      .orderBy('lastActivityAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }
    const data = snapshot.docs[0].data() as FirestoreSessionDocument;
    return this.parseFirestoreDocument(data);
  }

  /**
   * Validate session and return detailed status (cache-first lookup with Firestore fallback)
   * Returns explicit status instead of boolean to avoid requiring additional calls
   * to determine why a session is invalid
   */
  async validateSession(userId: string): Promise<SessionValidationStatus> {
    // Cache is keyed by userId (one session per user in cache)
    const cachedSession = this.cache.get(userId);

    // Step 1: Check for userId mismatch (data integrity issue)
    if (cachedSession && cachedSession.userId !== userId) {
      this.cache.clear(userId);
      return SessionValidationStatus.DATA_INTEGRITY_ERROR;
    }

    // Step 2: Check if cached session is valid and not expired
    if (cachedSession && !this.cache.isExpired(userId)) {
      return SessionValidationStatus.VALID;
    }

    // Step 2b: Cached session exists but is expired — return EXPIRED so caller can require re-login
    if (cachedSession && this.cache.isExpired(userId)) {
      return SessionValidationStatus.EXPIRED;
    }

    // Step 3: Cache miss — query Firestore by userId (sessions live under user_sessions/{sessionId})
    const session = await this.findActiveSessionByUserId(userId);
    if (!session) {
      return SessionValidationStatus.NOT_FOUND;
    }

    if (session.userId !== userId) {
      return SessionValidationStatus.DATA_INTEGRITY_ERROR;
    }

    if (new Date() > session.expiresAt) {
      return SessionValidationStatus.EXPIRED;
    }

    // Repopulate cache for future requests
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
   * Check if a session document exists in Firestore for this user (regardless of expiration).
   * Uses a query by userId since documents are keyed by sessionId.
   */
  async sessionExists(userId: string): Promise<boolean> {
    const snapshot = await this.firestore
      .collection(this.collectionName)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return false;
    }
    const data = snapshot.docs[0].data() as FirestoreSessionDocument;
    return data.userId === userId;
  }

  /**
   * Ensure a session exists for the user (idempotent). Creates a new session only when none
   * exists or there is a data integrity issue. Returns true if a session was created, false if
   * one already existed and is valid.
   *
   * @param userId - User ID (from JWT sub)
   * @param tokenIssuedAt - Optional JWT iat; if provided, we reject tokens issued before logout
   * @throws TokenRevokedError if token was issued before logout
   * @throws Error if session is expired (user must logout and log in again; we do not auto-recreate)
   */
  async ensureSession(userId: string, tokenIssuedAt?: Date): Promise<boolean> {
    if (tokenIssuedAt) {
      const wasIssuedBeforeLogout = await this.wasTokenIssuedBeforeLogout(userId, tokenIssuedAt);
      if (wasIssuedBeforeLogout) {
        throw new TokenRevokedError();
      }
    }

    const status = await this.validateSession(userId);

    if (status === SessionValidationStatus.VALID) {
      return false;
    }

    if (status === SessionValidationStatus.EXPIRED) {
      throw new Error('Session has expired. Please logout and login again.');
    }

    // NOT_FOUND or DATA_INTEGRITY_ERROR: create a new session (new sessionId)
    await this.createSession(userId);
    return true;
  }

  /**
   * Create a new session. Session ID is an independent UUID (not derived from userId), so each
   * login gets a distinct session and logout/re-login works correctly.
   */
  async createSession(userId: string): Promise<void> {
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.inactivityTimeout);

    const session: SessionInfo = {
      sessionId,
      userId,
      createdAt: now,
      lastActivityAt: now,
      expiresAt,
    };

    // Cache is keyed by userId for lookup; document in Firestore is keyed by sessionId
    this.cache.set(userId, session);

    const docRef = this.firestore.collection(this.collectionName).doc(sessionId);
    await docRef.set(this.toFirestoreDocument(session));
  }

  /**
   * Update last activity timestamp and extend expiration. Cache is updated immediately for
   * fast reads; Firestore write is queued and throttled (see FirestoreSync).
   */
  async updateLastActivity(userId: string): Promise<void> {
    const status = await this.validateSession(userId);
    if (status !== SessionValidationStatus.VALID) {
      return; // Session doesn't exist or is expired; nothing to update
    }

    const session = this.cache.get(userId);
    if (!session) {
      return;
    }

    const updatedSession: SessionInfo = {
      ...session,
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + this.inactivityTimeout),
    };
    this.cache.set(userId, updatedSession);

    // Firestore write uses session.sessionId as document ID; throttled per user
    this.firestoreSync.queueWrite(userId, updatedSession);
  }

  /**
   * Clear session (logout). Removes all session documents for this user and records the logout
   * so tokens issued before this time can be rejected (see wasTokenIssuedBeforeLogout).
   */
  async clearSession(userId: string): Promise<void> {
    this.cache.clear(userId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.logoutTtlMs);

    // Logout record is keyed by userId (per-user, not per-session); used for token revocation check
    const logoutRef = this.firestore.collection(this.logoutsCollectionName).doc(userId);
    await logoutRef.set(
      this.toLogoutDocument({
        userId,
        loggedOutAt: now,
        expiresAt,
      }),
    );

    // Sessions are stored as user_sessions/{sessionId}; query by userId and delete each document
    const snapshot = await this.firestore
      .collection(this.collectionName)
      .where('userId', '==', userId)
      .get();
    for (const doc of snapshot.docs) {
      await doc.ref.delete();
    }
  }

  /**
   * Check if the JWT was issued before the user's last logout.
   * Logout records are stored at user_logouts/{userId} (one per user). We use this to reject
   * tokens that were issued before logout, since JWTs cannot be revoked directly.
   * Returns true if token was issued before logout (token should be rejected).
   */
  async wasTokenIssuedBeforeLogout(userId: string, tokenIssuedAt: Date): Promise<boolean> {
    const logoutRef = this.firestore.collection(this.logoutsCollectionName).doc(userId);
    const doc = await logoutRef.get();

    if (!doc.exists) {
      return false; // No logout recorded — token is acceptable
    }

    const data = doc.data() as FirestoreLogoutDocument;
    if (!data) {
      return false;
    }

    const logoutInfo = this.parseLogoutDocument(data);
    return tokenIssuedAt < logoutInfo.loggedOutAt;
  }

  /**
   * Warmup cache from Firestore on startup. Loads all non-expired sessions into the in-memory
   * cache (keyed by userId). Document IDs in user_sessions are sessionIds; we cache by userId
   * for lookup. Also performs lazy deletion of expired session documents.
   */
  async warmupCache(): Promise<void> {
    const collection = this.firestore.collection(this.collectionName);
    const now = new Date();

    const snapshot = await collection.where('expiresAt', '>', now).get();

    for (const doc of snapshot.docs) {
      const data = doc.data() as FirestoreSessionDocument;
      // Document ID must match sessionId in payload (data integrity)
      if (data.sessionId !== doc.id) {
        console.warn(
          `Skipping session with mismatched sessionId: document ID=${doc.id}, data.sessionId=${data.sessionId}`,
        );
        continue;
      }
      const session = this.parseFirestoreDocument(data);
      this.cache.set(session.userId, session);
    }

    // Lazy cleanup: delete expired session documents in batches
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
   * Parse Firestore session document (timestamp fields may be Firestore Timestamp or Date) into SessionInfo.
   */
  private parseFirestoreDocument(data: FirestoreSessionDocument): SessionInfo {
    return {
      sessionId: data.sessionId,
      userId: data.userId,
      createdAt: this.toDate(data.createdAt),
      lastActivityAt: this.toDate(data.lastActivityAt),
      expiresAt: this.toDate(data.expiresAt),
    };
  }

  /**
   * Convert SessionInfo to Firestore document format for user_sessions collection.
   */
  private toFirestoreDocument(session: SessionInfo): FirestoreSessionDocument {
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Normalize Firestore Timestamp or Date to JavaScript Date.
   */
  private toDate(timestamp: Timestamp | FirestoreTimestamp | Date): Date {
    if (timestamp instanceof Date) {
      return timestamp;
    }
    return timestamp.toDate();
  }

  /**
   * Parse Firestore logout document (user_logouts collection) into typed fields.
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
   * Convert logout info to Firestore document format for user_logouts collection.
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

