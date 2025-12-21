/**
 * Request queue for token refresh
 * Queues requests during token refresh and flushes them with the new token
 */
export class RequestQueue {
  private queuedRequests: Array<{
    resolve: (token: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reject: (error: any) => void;
  }> = [];

  /**
   * Queue a request to wait for token refresh
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queue(resolve: (token: string) => void, reject: (error: any) => void): void {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async rejectAll(error: any): Promise<void> {
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

