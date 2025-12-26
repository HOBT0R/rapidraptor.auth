/**
 * Request queue for token refresh
 * Queues requests during token refresh and flushes them with the new token
 */
export class RequestQueue {
  private queuedRequests: Array<{
    resolve: (token: string) => void;
    reject: (error: unknown) => void;
  }> = [];

  /**
   * Queue a request to wait for token refresh
   */
  queue(resolve: (token: string) => void, reject: (error: unknown) => void): void {
    this.queuedRequests.push({ resolve, reject });
  }

  /**
   * Flush all queued requests with new token
   */
  async flush(token: string): Promise<void> {
    const requests = [...this.queuedRequests];
    this.queuedRequests = [];
    requests.forEach(({ resolve }) => resolve(token));
  }

  /**
   * Reject all queued requests (on refresh failure)
   */
  async rejectAll(error: unknown): Promise<void> {
    const requests = [...this.queuedRequests];
    this.queuedRequests = [];
    requests.forEach(({ reject }) => reject(error));
  }

  /**
   * Get current queue size
   */
  getSize(): number {
    return this.queuedRequests.length;
  }
}

