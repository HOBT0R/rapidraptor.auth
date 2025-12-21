import type { FirebaseAuth } from '@rapidraptor/auth-shared';
import { RequestQueue } from './requestQueue.js';

/**
 * Token manager with request queuing during refresh
 */
export class TokenManager {
  private auth: FirebaseAuth;
  private refreshPromise: Promise<string> | null = null;
  private requestQueue: RequestQueue;

  constructor(auth: FirebaseAuth) {
    this.auth = auth;
    this.requestQueue = new RequestQueue();
  }

  /**
   * Get token (with optional force refresh)
   */
  async getToken(forceRefresh: boolean = false): Promise<string | null> {
    const user = this.auth.currentUser;
    if (!user) {
      return null;
    }

    return user.getIdToken(forceRefresh);
  }

  /**
   * Refresh token with queuing
   * If refresh is already in progress, returns the same promise
   */
  async refreshToken(): Promise<string> {
    // If refresh already in progress, return the existing promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start refresh
    this.refreshPromise = (async () => {
      try {
        // Force token refresh
        const user = this.auth.currentUser;
        if (!user) {
          throw new Error('No user authenticated');
        }
        const token = await user.getIdToken(true);

        // Flush queued requests with new token
        await this.requestQueue.flush(token);

        return token;
      } catch (error) {
        // Token refresh failed - reject all queued requests
        await this.requestQueue.rejectAll(error);
        throw error; // Re-throw to trigger logout in error handler
      } finally {
        // Clear refresh promise
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }
}

