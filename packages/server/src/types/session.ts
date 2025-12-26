import type { SessionInfo } from '@rapidraptor/auth-shared';

/**
 * Type alias for session storage maps
 * Used for in-memory caches and write queues
 */
export type SessionMap = Map<string, SessionInfo>;


