import type { SessionInfo } from '@rapidraptor/auth-shared';
import type { SessionMap } from '../types/session.js';

/**
 * In-memory cache for fast session lookups
 */
export class SessionCache {
  private sessions: SessionMap;

  constructor(_inactivityTimeout: number) {
    // inactivityTimeout is kept for API compatibility but not used
    // Expiration is determined by session.expiresAt
    this.sessions = new Map();
  }

  /**
   * Get session from cache
   */
  get(userId: string): SessionInfo | null {
    return this.sessions.get(userId) || null;
  }

  /**
   * Store session in cache
   */
  set(userId: string, session: SessionInfo): void {
    this.sessions.set(userId, session);
  }

  /**
   * Check if session is expired
   */
  isExpired(userId: string): boolean {
    const session = this.get(userId);
    if (!session) {
      return true;
    }
    return new Date() > session.expiresAt;
  }

  /**
   * Remove session from cache
   */
  clear(userId: string): void {
    this.sessions.delete(userId);
  }

  /**
   * Cleanup expired sessions from cache
   */
  clearExpired(): void {
    const now = new Date();
    for (const [userId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(userId);
      }
    }
  }

  /**
   * Get all cached session user IDs
   */
  getAllUserIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Clear all sessions from cache
   */
  clearAll(): void {
    this.sessions.clear();
  }
}

