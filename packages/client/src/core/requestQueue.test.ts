import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestQueue } from './requestQueue.js';

describe('RequestQueue', () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue();
  });

  describe('queue', () => {
    it('should queue requests', () => {
      const resolve = vi.fn();
      const reject = vi.fn();
      queue.queue(resolve, reject);
      expect(queue.getSize()).toBe(1);
    });

    it('should queue multiple requests', () => {
      queue.queue(vi.fn(), vi.fn());
      queue.queue(vi.fn(), vi.fn());
      expect(queue.getSize()).toBe(2);
    });
  });

  describe('flush', () => {
    it('should flush all queued requests with token', async () => {
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();
      const reject1 = vi.fn();
      const reject2 = vi.fn();

      queue.queue(resolve1, reject1);
      queue.queue(resolve2, reject2);

      const token = 'new-token';
      await queue.flush(token);

      expect(resolve1).toHaveBeenCalledWith(token);
      expect(resolve2).toHaveBeenCalledWith(token);
      expect(reject1).not.toHaveBeenCalled();
      expect(reject2).not.toHaveBeenCalled();
      expect(queue.getSize()).toBe(0);
    });

    it('should clear queue after flush', async () => {
      queue.queue(vi.fn(), vi.fn());
      await queue.flush('token');
      expect(queue.getSize()).toBe(0);
    });
  });

  describe('rejectAll', () => {
    it('should reject all queued requests with error', async () => {
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();
      const reject1 = vi.fn();
      const reject2 = vi.fn();

      queue.queue(resolve1, reject1);
      queue.queue(resolve2, reject2);

      const error = new Error('Refresh failed');
      await queue.rejectAll(error);

      expect(reject1).toHaveBeenCalledWith(error);
      expect(reject2).toHaveBeenCalledWith(error);
      expect(resolve1).not.toHaveBeenCalled();
      expect(resolve2).not.toHaveBeenCalled();
      expect(queue.getSize()).toBe(0);
    });

    it('should clear queue after rejectAll', async () => {
      queue.queue(vi.fn(), vi.fn());
      await queue.rejectAll(new Error('test'));
      expect(queue.getSize()).toBe(0);
    });
  });

  describe('getSize', () => {
    it('should return 0 for empty queue', () => {
      expect(queue.getSize()).toBe(0);
    });

    it('should return correct size', () => {
      queue.queue(vi.fn(), vi.fn());
      queue.queue(vi.fn(), vi.fn());
      expect(queue.getSize()).toBe(2);
    });
  });
});




