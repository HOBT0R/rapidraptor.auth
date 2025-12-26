import { describe, it, expect, beforeEach } from 'vitest';
import { SessionCache } from './sessionCache.js';
import type { SessionInfo } from '@rapidraptor/auth-shared';

describe('SessionCache', () => {
  let cache: SessionCache;
  const inactivityTimeout = 24 * 60 * 60 * 1000; // 24 hours

  beforeEach(() => {
    cache = new SessionCache(inactivityTimeout);
  });

  describe('get', () => {
    it('should return null for non-existent session', () => {
      expect(cache.get('user1')).toBeNull();
    });

    it('should return session when it exists', () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      cache.set('user1', session);
      expect(cache.get('user1')).toEqual(session);
    });
  });

  describe('set', () => {
    it('should store session in cache', () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      cache.set('user1', session);
      expect(cache.get('user1')).toEqual(session);
    });
  });

  describe('isExpired', () => {
    it('should return true for non-existent session', () => {
      expect(cache.isExpired('user1')).toBe(true);
    });

    it('should return false for valid session', () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      cache.set('user1', session);
      expect(cache.isExpired('user1')).toBe(false);
    });

    it('should return true for expired session', () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(Date.now() - inactivityTimeout),
        lastActivityAt: new Date(Date.now() - inactivityTimeout),
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      };
      cache.set('user1', session);
      expect(cache.isExpired('user1')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove session from cache', () => {
      const session: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      cache.set('user1', session);
      cache.clear('user1');
      expect(cache.get('user1')).toBeNull();
    });
  });

  describe('clearExpired', () => {
    it('should remove expired sessions', () => {
      const expiredSession: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(Date.now() - inactivityTimeout),
        lastActivityAt: new Date(Date.now() - inactivityTimeout),
        expiresAt: new Date(Date.now() - 1000),
      };
      const validSession: SessionInfo = {
        userId: 'user2',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      cache.set('user1', expiredSession);
      cache.set('user2', validSession);
      cache.clearExpired();
      expect(cache.get('user1')).toBeNull();
      expect(cache.get('user2')).toEqual(validSession);
    });
  });

  describe('clearAll', () => {
    it('should remove all sessions', () => {
      const session1: SessionInfo = {
        userId: 'user1',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      const session2: SessionInfo = {
        userId: 'user2',
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + inactivityTimeout),
      };
      cache.set('user1', session1);
      cache.set('user2', session2);
      cache.clearAll();
      expect(cache.get('user1')).toBeNull();
      expect(cache.get('user2')).toBeNull();
    });
  });
});




