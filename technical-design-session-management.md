---
title: Technical Design - Session Management and Token Expiration
version: 1.0
status: Draft
date: 2024
---

# Technical Design: Session Management and Token Expiration

## Document Purpose

This technical design document provides detailed implementation specifications for the session management and token expiration solution. It should be read in conjunction with the [Solution Design Document](./solution-design-session-management.md).

**Audience:** Development team, architects, and technical stakeholders

## Table of Contents

1. [Fit-Gap Analysis](#fit-gap-analysis)
2. [Open Source Alternatives](#open-source-alternatives)
3. [Repository Structure](#repository-structure)
4. [System Architecture](#system-architecture)
5. [Module Pseudo Code](#module-pseudo-code)
6. [Data Models](#data-models)
7. [API Specifications](#api-specifications)
8. [Performance and Scaling](#performance-and-scaling)
9. [Security Considerations](#security-considerations)
10. [Implementation Details](#implementation-details)
11. [Testing Strategy](#testing-strategy)
12. [Deployment Considerations](#deployment-considerations)

## Fit-Gap Analysis

### Firebase SDK Capabilities

#### What Firebase Auth Provides Out-of-the-Box

1. **JWT Token Generation and Validation**
   - ✅ Automatic token generation on user login
   - ✅ Token expiration (typically 1 hour)
   - ✅ Token refresh via `getIdToken(true)`
   - ✅ Server-side token verification via Firebase Admin SDK

2. **Session Cookies** (Server-side)
   - ✅ Session cookies with configurable expiration (5 minutes to 2 weeks)
   - ✅ JWT-based session tokens
   - ✅ `httpOnly` cookie support for XSS protection
   - ✅ Session cookie revocation

3. **Client-Side Session Persistence**
   - ✅ `LOCAL` persistence (survives browser close)
   - ✅ `SESSION` persistence (cleared on tab close)
   - ✅ `NONE` persistence (memory only)

#### What Firebase Auth Does NOT Provide

1. **Inactivity-Based Session Expiration**
   - ❌ No server-side tracking of user activity
   - ❌ No automatic expiration after inactivity period
   - ❌ No `lastActivityAt` timestamp tracking

2. **Server-Side Session State Management**
   - ❌ No built-in session storage in Firestore
   - ❌ No session validation beyond JWT verification
   - ❌ No distinction between token expiration and session expiration

3. **Session Lifecycle Management**
   - ❌ No automatic session creation on first request
   - ❌ No session cleanup/expiration service
   - ❌ No session warmup/cache restoration

### Gap Analysis Summary

| Requirement | Firebase SDK Support | Gap | Custom Implementation Needed |
|------------|---------------------|-----|------------------------------|
| Inactivity timeout | ❌ | High | ✅ Yes - Custom session tracking |
| Server-side session state | ❌ | High | ✅ Yes - Firestore + cache |
| Session expiration detection | ❌ | High | ✅ Yes - Custom validation logic |
| Token vs Session distinction | ❌ | High | ✅ Yes - Custom error codes |
| Activity tracking | ❌ | High | ✅ Yes - Custom `lastActivityAt` updates |
| Session warmup | ❌ | Medium | ✅ Yes - Custom cache initialization |

**Conclusion:** Firebase Auth provides excellent token management but lacks server-side session lifecycle management. We need to build a custom session management layer on top of Firebase Auth.

### Session Cookies vs JWT Tokens Analysis

#### Option 1: Current Approach (JWT in Authorization Header)

**Architecture:**
- Frontend: JWT token from Firebase Auth client SDK
- Transport: `Authorization: Bearer <token>` header
- Backend: Verify JWT, then check session validity

**Pros:**
- ✅ Works with any client (web, mobile, API clients)
- ✅ No CORS complexity (no credentials needed)
- ✅ No CSRF protection required
- ✅ Stateless token (works across domains)
- ✅ Simple client implementation (just add header)

**Cons:**
- ❌ Token stored in memory/localStorage (XSS risk if not careful)
- ❌ Requires manual header injection
- ❌ Token visible in client-side code

#### Option 2: Firebase Session Cookies

**Architecture:**
- Frontend: Exchange Firebase JWT for session cookie
- Transport: HTTP-only cookie (automatic)
- Backend: Verify session cookie, then check session validity

**Pros:**
- ✅ HttpOnly cookies (XSS protection)
- ✅ Automatic transmission (no client code needed)
- ✅ Built-in Firebase Admin SDK support (`createSessionCookie()`)
- ✅ More secure by default

**Cons:**
- ❌ **Still requires Firestore for inactivity tracking** (session cookies have absolute expiration, not inactivity-based)
- ❌ CORS complexity (must enable `withCredentials`)
- ❌ CSRF protection required
- ❌ Browser-only (doesn't work for mobile apps or API clients)
- ❌ Cookie size limits (~4KB)
- ❌ More complex client implementation (cookie exchange flow)

#### Critical Finding: Session Cookies Don't Solve Inactivity Problem

**Firebase Session Cookies:**
- Expiration: **Absolute** (set at creation time, e.g., "expires in 24 hours")
- **NOT inactivity-based** (doesn't reset on activity)

**Our Requirement:**
- Expiration: **Inactivity-based** (expires 24 hours after last activity)
- Must track `lastActivityAt` and recalculate expiration

**Conclusion:** Even with session cookies, we'd still need:
1. ✅ Firestore to track `lastActivityAt`
2. ✅ Custom logic to check inactivity expiration
3. ✅ Session validation service
4. ✅ Cache layer for performance

**The only difference:** How we transport the session identifier (cookie vs header).

#### Recommendation: Stick with JWT in Authorization Header

**Reasoning:**
1. **Inactivity tracking is still required** - Session cookies don't eliminate this need
2. **API-first architecture** - Works with mobile apps and API clients
3. **Simpler CORS** - No credentials complexity
4. **No CSRF protection needed** - Headers are CSRF-safe
5. **Current implementation** - Less migration work

**Security Note:** We can mitigate XSS risk by:
- Using `sessionStorage` instead of `localStorage` (cleared on tab close)
- Implementing Content Security Policy (CSP)
- Keeping tokens in memory only (no persistent storage)

**Alternative Consideration:** If we wanted to use session cookies, we'd need to:
1. Add cookie exchange endpoint (`POST /auth/session-cookie`)
2. Enable CORS credentials (`withCredentials: true`)
3. Implement CSRF protection (double-submit cookie pattern)
4. Still build all the inactivity tracking logic (no simplification)
5. Lose mobile/API client support

**Verdict:** ❌ Session cookies add complexity without solving the core problem (inactivity tracking).

## Open Source Alternatives

### Research Summary

#### 1. Express-Session with Firestore Adapter

**Packages Evaluated:**
- `express-session` - Standard Express session middleware
- `@google-cloud/connect-firestore` - Firestore adapter for express-session

**Analysis:**
- ✅ Provides session storage in Firestore
- ✅ Works with Express middleware
- ❌ **Gap:** Designed for traditional session cookies, not JWT-based auth
- ❌ **Gap:** No inactivity timeout support (only absolute expiration)
- ❌ **Gap:** No distinction between token and session expiration
- ❌ **Gap:** Requires session cookie management (we use JWT in Authorization header)

**Verdict:** ❌ Not suitable - Designed for different authentication model

#### 2. Firebase Admin Session Management Libraries

**Packages Evaluated:**
- `firebase-admin` - Official Firebase Admin SDK
- Custom implementations in various GitHub repositories

**Analysis:**
- ✅ Firebase Admin SDK provides Firestore access
- ✅ Token verification capabilities
- ❌ **Gap:** No existing library found that implements inactivity-based session expiration
- ❌ **Gap:** Most implementations are project-specific, not reusable libraries
- ❌ **Gap:** No unified client/server library pattern

**Verdict:** ❌ No suitable existing library found

#### 3. Redis-Based Session Management

**Packages Evaluated:**
- `express-session` with `connect-redis`
- `ioredis` for Redis connectivity

**Analysis:**
- ✅ Distributed cache (works across instances)
- ✅ Built-in TTL support
- ❌ **Gap:** Requires additional infrastructure (Redis instance)
- ❌ **Gap:** Additional cost and complexity
- ❌ **Gap:** Not aligned with existing Firestore infrastructure
- ❌ **Gap:** Still requires custom inactivity tracking logic

**Verdict:** ❌ Not suitable - Adds infrastructure complexity without solving core gap

#### 4. Custom Session Management Patterns

**Research Findings:**
- Most Firebase-based applications implement custom session management
- Common pattern: Firestore + in-memory cache
- No standardized library exists for this pattern

**Verdict:** ✅ Custom implementation is the standard approach

### Recommendation

**Build Custom Library:** No suitable open-source alternative exists that meets our requirements. The combination of:
- JWT-based authentication (not session cookies)
- Inactivity-based expiration
- Firestore persistence
- Client/server unified library

...is unique enough to warrant a custom implementation. This aligns with how most Firebase applications handle session management.

## Repository Structure

### Monorepo Organization

The `@rapidraptor/auth` library is organized as a monorepo using npm workspaces:

```
rapidraptor-auth/
├── packages/
│   ├── client/              # Frontend library (@rapidraptor/auth-client)
│   │   ├── src/
│   │   │   ├── core/
│   │   │   │   ├── apiClient.ts        # Axios client with interceptors
│   │   │   │   ├── tokenManager.ts     # Token refresh logic
│   │   │   │   ├── errorHandler.ts     # 401 error detection and handling
│   │   │   │   └── requestQueue.ts    # Request queuing during refresh
│   │   │   ├── react/
│   │   │   │   ├── AuthContext.tsx     # React Context provider (optional)
│   │   │   │   ├── useApiClient.ts     # Hook for API client
│   │   │   │   └── useSessionMonitor.ts # Hook for session warnings
│   │   │   └── index.ts                 # Public API exports
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── server/              # Backend library (@rapidraptor/auth-server)
│   │   ├── src/
│   │   │   ├── session/
│   │   │   │   ├── sessionService.ts   # Main session management service
│   │   │   │   ├── sessionCache.ts     # In-memory cache implementation
│   │   │   │   ├── firestoreSync.ts    # Firestore batch sync
│   │   │   │   └── types.ts            # Server-specific types
│   │   │   ├── firebase/
│   │   │   │   └── admin.ts            # Firebase Admin SDK initialization
│   │   │   ├── middleware/
│   │   │   │   └── authMiddleware.ts   # Express middleware factory
│   │   │   └── index.ts                 # Public API exports
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/              # Shared types (@rapidraptor/auth-shared)
│       ├── src/
│       │   ├── types.ts                 # SessionInfo, ErrorResponse, etc.
│       │   ├── constants.ts             # Error codes, defaults
│       │   └── index.ts                 # Public API exports
│       ├── package.json
│       └── tsconfig.json
│
├── package.json              # Root workspace config
├── tsconfig.json             # Root TypeScript config
├── README.md                 # Library documentation
└── .github/                  # CI/CD workflows
```

### Package Dependencies

**Root `package.json`:**
- Workspace management (npm workspaces)
- Build scripts
- Test scripts
- Export paths configuration

**`packages/client/package.json`:**
- Peer dependencies: `firebase`, `axios`, `react` (optional)
- Internal dependency: `@rapidraptor/auth-shared`

**`packages/server/package.json`:**
- Dependency: `firebase-admin`
- Internal dependency: `@rapidraptor/auth-shared`

**`packages/shared/package.json`:**
- No external dependencies (pure TypeScript types)

### Import Paths

```typescript
// Frontend usage
import { createApiClient } from '@rapidraptor/auth/client';
import { useApiClient } from '@rapidraptor/auth/client';

// Backend usage
import { createAuthMiddleware, SessionService } from '@rapidraptor/auth/server';
import { initializeFirebaseAdmin } from '@rapidraptor/auth/server';

// Shared types
import type { SessionInfo, ErrorResponse } from '@rapidraptor/auth/shared';
```

## System Architecture

### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    @rapidraptor/auth                         │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   /client    │  │   /server    │  │   /shared    │      │
│  │              │  │              │  │              │      │
│  │ - API Client │  │ - Session    │  │ - Types      │      │
│  │ - Token Mgr  │  │   Service    │  │ - Constants  │      │
│  │ - Error      │  │ - Cache      │  │ - Interfaces │      │
│  │   Handler    │  │ - Firestore  │  │              │      │
│  │ - React      │  │   Sync       │  │              │      │
│  │   Hooks      │  │ - Middleware │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Server Package Internal Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Auth Server Library                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Auth Middleware                        │    │
│  │  - JWT Verification (existing)                     │    │
│  │  - Session Validation (new)                        │    │
│  │  - Activity Tracking (new)                         │    │
│  └──────────────────┬──────────────────────────────────┘    │
│                     │                                         │
│  ┌──────────────────▼──────────────────────────────────┐  │
│  │              Session Service                           │  │
│  │  - isSessionValid()                                   │  │
│  │  - createSession()                                    │  │
│  │  - updateLastActivity()                              │  │
│  │  - clearSession()                                    │  │
│  └──────┬──────────────────────┬─────────────────────────┘  │
│         │                      │                              │
│  ┌──────▼──────┐      ┌────────▼──────────┐                 │
│  │   Session   │      │   Firestore       │                 │
│  │   Cache     │      │   Sync            │                 │
│  │             │      │                   │                 │
│  │ - In-memory │      │ - Batch writes    │                 │
│  │ - Fast      │      │ - Throttled       │                 │
│  │   lookup    │      │ - Queued          │                 │
│  └─────────────┘      └────────┬──────────┘                 │
│                                  │                             │
│                         ┌────────▼──────────┐                 │
│                         │     Firestore     │                 │
│                         │   (Database)      │                 │
│                         └───────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

### Client Package Internal Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Auth Client Library                       │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              API Client (Axios)                      │    │
│  │  - Request Interceptor (token injection)            │    │
│  │  - Response Interceptor (error handling)           │    │
│  └──────┬──────────────────────┬─────────────────────────┘    │
│         │                      │                              │
│  ┌──────▼──────┐      ┌────────▼──────────┐                 │
│  │   Token     │      │   Error          │                 │
│  │   Manager   │      │   Handler        │                 │
│  │             │      │                   │                 │
│  │ - Refresh   │      │ - Detect error   │                 │
│  │ - Queue     │      │   type           │                 │
│  │ - Retry     │      │ - Trigger        │                 │
│  │             │      │   actions        │                 │
│  └─────────────┘      └────────┬──────────┘                 │
│                                 │                             │
│                        ┌────────▼──────────┐                 │
│                        │   Request Queue   │                 │
│                        │  - Queue during   │                 │
│                        │    refresh        │                 │
│                        │  - Flush after    │                 │
│                        │    refresh        │                 │
│                        └───────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## Module Pseudo Code

This section provides high-level pseudo code for the main modules, highlighting where Firebase SDK is used versus where custom code is required.

### Server Package Modules

#### `packages/server/src/firebase/admin.ts`

**Purpose:** Initialize Firebase Admin SDK for Firestore access

**Firebase SDK Usage:** ✅ Uses `firebase-admin`

```typescript
// NEW CODE: Firebase Admin initialization wrapper
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let firestoreInstance: Firestore | null = null;

async function initializeFirebaseAdmin(): Promise<void> {
  // NEW CODE: Check if already initialized
  if (getApps().length > 0) {
    firestoreInstance = getFirestore();
    return;
  }

  // NEW CODE: Initialize from environment variables or service account file
  const credentials = getCredentialsFromEnv() || getCredentialsFromFile();
  
  // FIREBASE SDK: Initialize Firebase Admin
  initializeApp({
    credential: cert(credentials),
    projectId: process.env.FIREBASE_PROJECT_ID
  });

  // FIREBASE SDK: Get Firestore instance
  firestoreInstance = getFirestore();
}

function getFirestore(): Firestore {
  // NEW CODE: Ensure initialized before use
  if (!firestoreInstance) {
    throw new Error('Firebase Admin not initialized');
  }
  return firestoreInstance;
}
```

**Key Points:**
- ✅ Uses Firebase Admin SDK (`firebase-admin/app`, `firebase-admin/firestore`)
- ✅ NEW CODE: Credential loading logic
- ✅ NEW CODE: Initialization state management

---

#### `packages/server/src/session/sessionCache.ts`

**Purpose:** In-memory cache for fast session lookups

**Firebase SDK Usage:** ❌ No Firebase SDK (pure TypeScript)

```typescript
// NEW CODE: Custom in-memory cache implementation
import type { SessionInfo } from '@rapidraptor/auth-shared';

class SessionCache {
  private sessions: Map<string, SessionInfo>;
  private inactivityTimeout: number;

  constructor(inactivityTimeout: number) {
    this.sessions = new Map();
    this.inactivityTimeout = inactivityTimeout;
  }

  // NEW CODE: Get session from cache
  get(userId: string): SessionInfo | null {
    return this.sessions.get(userId) || null;
  }

  // NEW CODE: Store session in cache
  set(userId: string, session: SessionInfo): void {
    this.sessions.set(userId, session);
  }

  // NEW CODE: Check if session expired
  isExpired(userId: string): boolean {
    const session = this.get(userId);
    if (!session) return true;
    return new Date() > session.expiresAt;
  }

  // NEW CODE: Remove session from cache
  clear(userId: string): void {
    this.sessions.delete(userId);
  }

  // NEW CODE: Cleanup expired sessions
  clearExpired(): void {
    for (const [userId, session] of this.sessions.entries()) {
      if (this.isExpired(userId)) {
        this.sessions.delete(userId);
      }
    }
  }
}
```

**Key Points:**
- ❌ No Firebase SDK (pure TypeScript Map)
- ✅ NEW CODE: All cache logic is custom

---

#### `packages/server/src/session/firestoreSync.ts`

**Purpose:** Batch and throttle Firestore writes

**Firebase SDK Usage:** ✅ Uses `firebase-admin/firestore`

```typescript
// NEW CODE: Custom Firestore sync with throttling
import { Firestore } from 'firebase-admin/firestore';
import type { SessionInfo } from '@rapidraptor/auth-shared';

class FirestoreSync {
  private firestore: Firestore;
  private writeQueue: Map<string, SessionInfo>;
  private throttleMs: number;
  private lastWriteTime: Map<string, number>;

  constructor(firestore: Firestore, throttleMs: number) {
    this.firestore = firestore;
    this.writeQueue = new Map();
    this.throttleMs = throttleMs;
    this.lastWriteTime = new Map();
  }

  // NEW CODE: Queue write with throttling
  queueWrite(userId: string, session: SessionInfo): void {
    const now = Date.now();
    const lastWrite = this.lastWriteTime.get(userId) || 0;

    // NEW CODE: Throttle logic
    if (now - lastWrite < this.throttleMs) {
      // Update queue but don't write yet
      this.writeQueue.set(userId, session);
      return;
    }

    // FIREBASE SDK: Immediate write (first write or after throttle)
    this.writeQueue.set(userId, session);
    this.lastWriteTime.set(userId, now);
  }

  // NEW CODE: Batch sync all queued writes
  async batchSync(): Promise<void> {
    if (this.writeQueue.size === 0) return;

    // FIREBASE SDK: Create Firestore batch
    const batch = this.firestore.batch();
    const collection = this.firestore.collection('user_sessions');

    // NEW CODE: Add all queued writes to batch
    for (const [userId, session] of this.writeQueue.entries()) {
      const docRef = collection.doc(userId);
      batch.set(docRef, {
        userId: session.userId,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        expiresAt: session.expiresAt
      });
    }

    // FIREBASE SDK: Commit batch write
    await batch.commit();

    // NEW CODE: Clear queue
    this.writeQueue.clear();
  }
}
```

**Key Points:**
- ✅ Uses Firebase Admin SDK (`firebase-admin/firestore`)
- ✅ NEW CODE: Throttling logic
- ✅ NEW CODE: Batch write queue management
- ✅ NEW CODE: Converts SessionInfo to Firestore document format

---

#### `packages/server/src/session/sessionService.ts`

**Purpose:** Main session management service (cache-first, Firestore fallback)

**Firebase SDK Usage:** ✅ Uses `firebase-admin/firestore`

```typescript
// NEW CODE: Session service with cache-first lookup
import { Firestore } from 'firebase-admin/firestore';
import { SessionCache } from './sessionCache';
import { FirestoreSync } from './firestoreSync';
import type { SessionInfo } from '@rapidraptor/auth-shared';

class SessionService {
  private cache: SessionCache;
  private firestoreSync: FirestoreSync;
  private firestore: Firestore;
  private inactivityTimeout: number;

  constructor(
    cache: SessionCache,
    firestoreSync: FirestoreSync,
    firestore: Firestore,
    inactivityTimeout: number
  ) {
    this.cache = cache;
    this.firestoreSync = firestoreSync;
    this.firestore = firestore;
    this.inactivityTimeout = inactivityTimeout;
  }

  // NEW CODE: Check session validity (cache-first)
  async isSessionValid(userId: string): Promise<boolean> {
    // NEW CODE: Check cache first
    if (this.cache.get(userId) && !this.cache.isExpired(userId)) {
      return true;
    }

    // NEW CODE: Cache miss or expired - check Firestore
    // FIREBASE SDK: Read from Firestore
    const docRef = this.firestore.collection('user_sessions').doc(userId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return false;
    }

    // NEW CODE: Parse Firestore document
    const data = doc.data() as SessionInfo;
    const session: SessionInfo = {
      userId: data.userId,
      createdAt: data.createdAt.toDate(),
      lastActivityAt: data.lastActivityAt.toDate(),
      expiresAt: data.expiresAt.toDate()
    };

    // NEW CODE: Check expiration
    if (new Date() > session.expiresAt) {
      return false;
    }

    // NEW CODE: Update cache
    this.cache.set(userId, session);
    return true;
  }

  // NEW CODE: Check if session exists in Firestore (regardless of expiration)
  async sessionExists(userId: string): Promise<boolean> {
    // FIREBASE SDK: Check if document exists
    const docRef = this.firestore.collection('user_sessions').doc(userId);
    const doc = await docRef.get();
    return doc.exists;
  }

  // NEW CODE: Ensure session exists (idempotent - creates if doesn't exist)
  // Returns true if session was created, false if it already existed
  async ensureSession(userId: string): Promise<boolean> {
    // NEW CODE: Use Firestore transaction to prevent race conditions
    const docRef = this.firestore.collection('user_sessions').doc(userId);
    
    return await this.firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      
      if (doc.exists) {
        // Session exists - check if expired
        const data = doc.data() as SessionInfo;
        const expiresAt = data.expiresAt.toDate();
        if (new Date() > expiresAt) {
          // Session expired
          return false;
        }
        // Session exists and is valid
        return false;
      }
      
      // NEW CODE: Create new session
      const now = new Date();
      const session: SessionInfo = {
        userId,
        createdAt: now,
        lastActivityAt: now,
        expiresAt: new Date(now.getTime() + this.inactivityTimeout)
      };
      
      // FIREBASE SDK: Create session in transaction
      transaction.set(docRef, {
        userId: session.userId,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        expiresAt: session.expiresAt
      });
      
      // NEW CODE: Update cache
      this.cache.set(userId, session);
      
      return true; // Session was created
    });
  }

  // NEW CODE: Create new session
  async createSession(userId: string): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.inactivityTimeout);

    const session: SessionInfo = {
      userId,
      createdAt: now,
      lastActivityAt: now,
      expiresAt
    };

    // NEW CODE: Update cache immediately
    this.cache.set(userId, session);

    // FIREBASE SDK: Write to Firestore immediately (no throttle on creation)
    const docRef = this.firestore.collection('user_sessions').doc(userId);
    await docRef.set({
      userId: session.userId,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt
    });
  }

  // NEW CODE: Update last activity
  // Note: Cache is updated immediately for fast reads, but Firestore write
  // is throttled (5 min). This means cache may be ahead of Firestore, which
  // is acceptable since cache is the source of truth for active requests.
  // On cache miss, Firestore is checked and cache is updated.
  async updateLastActivity(userId: string): Promise<void> {
    const session = this.cache.get(userId);
    if (!session) {
      // NEW CODE: Fallback to Firestore if not in cache
      const isValid = await this.isSessionValid(userId);
      if (!isValid) return;
      // Session now in cache after isSessionValid call
    }

    // NEW CODE: Update cache immediately (fast path)
    const updatedSession: SessionInfo = {
      ...this.cache.get(userId)!,
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + this.inactivityTimeout)
    };
    this.cache.set(userId, updatedSession);

    // NEW CODE: Queue Firestore write (throttled - may not write immediately)
    // This is acceptable because cache is authoritative for active sessions
    this.firestoreSync.queueWrite(userId, updatedSession);
  }

  // NEW CODE: Clear session (logout)
  async clearSession(userId: string): Promise<void> {
    // NEW CODE: Clear cache
    this.cache.clear(userId);

    // FIREBASE SDK: Delete from Firestore
    const docRef = this.firestore.collection('user_sessions').doc(userId);
    await docRef.delete();
  }

  // NEW CODE: Warmup cache from Firestore
  // Note: For large user bases (>10,000 active sessions), consider pagination
  // or lazy loading. Current implementation loads all active sessions.
  async warmupCache(): Promise<void> {
    // FIREBASE SDK: Query active sessions
    const collection = this.firestore.collection('user_sessions');
    const now = new Date();
    
    // NEW CODE: Paginate if needed (for very large user bases)
    // For now, load all active sessions (acceptable for <10K users)
    const snapshot = await collection
      .where('expiresAt', '>', now)
      .get();

    // NEW CODE: Load into cache
    for (const doc of snapshot.docs) {
      const data = doc.data() as SessionInfo;
      const session: SessionInfo = {
        userId: data.userId,
        createdAt: data.createdAt.toDate(),
        lastActivityAt: data.lastActivityAt.toDate(),
        expiresAt: data.expiresAt.toDate()
      };
      this.cache.set(session.userId, session);
    }
  }
}
```

**Key Points:**
- ✅ Uses Firebase Admin SDK (`firebase-admin/firestore`)
- ✅ NEW CODE: Cache-first lookup logic
- ✅ NEW CODE: Session expiration calculation
- ✅ NEW CODE: Activity tracking logic
- ✅ NEW CODE: `sessionExists()` method to check Firestore without expiration check
- ✅ NEW CODE: `ensureSession()` method with Firestore transaction (prevents race conditions)

---

#### `packages/server/src/middleware/authMiddleware.ts`

**Purpose:** Express middleware for session validation

**Firebase SDK Usage:** ⚠️ Indirect (uses existing JWT verifier)

```typescript
// NEW CODE: Auth middleware with session validation
import { RequestHandler } from 'express';
import { SessionService } from '../session/sessionService';
// Uses existing JWT verifier (not shown, but uses Firebase Admin SDK)

export function createAuthMiddleware(
  userTokenVerifier: UserTokenVerifier,  // Existing - uses Firebase Admin SDK
  sessionService: SessionService,
  logger?: Logger
): RequestHandler {
  return async (req, res, next) => {
    try {
      // EXISTING CODE: JWT verification (uses Firebase Admin SDK internally)
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        throw new AuthenticationError('Authorization header required');
      }

      const token = authHeader.split(' ')[1];
      // EXISTING CODE: Verify JWT (uses Firebase Admin SDK)
      const user = await userTokenVerifier.verify(token);

      // NEW CODE: Check session validity with Firestore error handling
      let isValid: boolean;
      try {
        isValid = await sessionService.isSessionValid(user.sub);
      } catch (error: any) {
        // NEW CODE: Handle Firestore unavailability
        if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
          logger?.error('Firestore unavailable for session validation', {
            error: error.message,
            userId: user.sub
          });
          return res.status(503).json({
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'User sessions could not be validated',
              requiresLogout: false,
              sessionExpired: false,
              timestamp: new Date().toISOString()
            }
          });
        }
        throw error; // Re-throw other errors
      }

      if (!isValid) {
        // NEW CODE: Try to ensure session exists (idempotent, handles race conditions)
        const wasCreated = await sessionService.ensureSession(user.sub);
        
        if (!wasCreated) {
          // Session exists but expired (ensureSession returns false for expired sessions)
          return res.status(401).json({
            error: {
              code: 'SESSION_EXPIRED',
              message: 'Session has expired due to inactivity',
              requiresLogout: true,
              sessionExpired: true,
              timestamp: new Date().toISOString()
            }
          });
        }
        // Session was created, continue
      } else {
        // NEW CODE: Update activity (async, don't wait)
        sessionService.updateLastActivity(user.sub).catch(err => {
          logger?.error('Failed to update activity', { error: err });
        });
      }

      // EXISTING CODE: Attach user to request
      req.user = user;
      next();
    } catch (error) {
      // EXISTING CODE: Handle JWT errors
      if (error instanceof UserTokenVerificationError) {
        return res.status(401).json({
          error: {
            code: error.isExpired ? 'TOKEN_EXPIRED' : 'AUTH_FAILED',
            message: error.message,
            sessionExpired: false,
            requiresLogout: error.isExpired,
            timestamp: new Date().toISOString()
          }
        });
      }
      next(error);
    }
  };
}
```

**Key Points:**
- ⚠️ Uses existing JWT verifier (which uses Firebase Admin SDK)
- ✅ NEW CODE: Session validation logic
- ✅ NEW CODE: Session creation on first request (using `ensureSession()` to prevent race conditions)
- ✅ NEW CODE: Activity tracking
- ✅ NEW CODE: Error response formatting with `sessionExpired` flag
- ✅ NEW CODE: Firestore error handling (returns 503 on unavailability)

---

### Client Package Modules

#### `packages/client/src/core/apiClient.ts`

**Purpose:** Axios client with token injection and error handling

**Firebase SDK Usage:** ✅ Uses `firebase/auth`

```typescript
// NEW CODE: API client factory
import axios, { AxiosInstance } from 'axios';
import { Auth } from 'firebase/auth';
import { TokenManager } from './tokenManager';
import { ErrorHandler } from './errorHandler';

export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const { baseURL, auth, onLogout, maxRetries = 1 } = config;

  const client = axios.create({ baseURL });
  const tokenManager = new TokenManager(auth);
  const errorHandler = new ErrorHandler(onLogout);

  // NEW CODE: Request interceptor - inject token
  client.interceptors.request.use(
    async (config) => {
      // FIREBASE SDK: Get current user token
      const token = await tokenManager.getToken(false);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    }
  );

  // NEW CODE: Response interceptor - handle errors
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (error.response?.status === 401) {
        return errorHandler.handle401Error(error, tokenManager, client, maxRetries);
      }
      return Promise.reject(error);
    }
  );

  return client;
}
```

**Key Points:**
- ✅ Uses Firebase Auth SDK (`firebase/auth`)
- ✅ NEW CODE: Interceptor setup
- ✅ NEW CODE: Token injection logic

---

#### `packages/client/src/core/tokenManager.ts`

**Purpose:** Token refresh with request queuing

**Firebase SDK Usage:** ✅ Uses `firebase/auth`

```typescript
// NEW CODE: Token manager with queuing
import { Auth, User } from 'firebase/auth';
import { RequestQueue } from './requestQueue';

class TokenManager {
  private auth: Auth;
  private refreshPromise: Promise<string> | null = null;
  private requestQueue: RequestQueue;

  constructor(auth: Auth) {
    this.auth = auth;
    this.requestQueue = new RequestQueue();
  }

  // NEW CODE: Get token (with optional force refresh)
  async getToken(forceRefresh: boolean = false): Promise<string | null> {
    // FIREBASE SDK: Get current user
    const user = this.auth.currentUser;
    if (!user) return null;

    // FIREBASE SDK: Get token (with optional refresh)
    return user.getIdToken(forceRefresh);
  }

  // NEW CODE: Refresh token with queuing
  async refreshToken(): Promise<string> {
    // NEW CODE: If refresh already in progress, queue and wait
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // NEW CODE: Start refresh
    this.refreshPromise = (async () => {
      try {
        // FIREBASE SDK: Force token refresh
        const user = this.auth.currentUser;
        if (!user) {
          throw new Error('No user authenticated');
        }
        const token = await user.getIdToken(true);

        // NEW CODE: Flush queued requests with new token
        await this.requestQueue.flush(token);

        return token;
      } catch (error) {
        // NEW CODE: Token refresh failed - reject all queued requests
        await this.requestQueue.rejectAll(error);
        throw error; // Re-throw to trigger logout in error handler
      } finally {
        // NEW CODE: Clear refresh promise
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }
}
```

**Key Points:**
- ✅ Uses Firebase Auth SDK (`firebase/auth`)
- ✅ NEW CODE: Request queuing logic
- ✅ NEW CODE: Concurrent request handling

---

#### `packages/client/src/core/errorHandler.ts`

**Purpose:** Detect error type and trigger appropriate action

**Firebase SDK Usage:** ⚠️ Indirect (via onLogout callback)

```typescript
// NEW CODE: Error handler for 401 responses
import { AxiosError, AxiosInstance } from 'axios';
import { TokenManager } from './tokenManager';

class ErrorHandler {
  private onLogout?: () => void | Promise<void>;

  constructor(onLogout?: () => void | Promise<void>) {
    this.onLogout = onLogout;
  }

  // NEW CODE: Handle 401 errors
  async handle401Error(
    error: AxiosError,
    tokenManager: TokenManager,
    client: AxiosInstance,
    maxRetries: number
  ): Promise<any> {
    const errorData = error.response?.data?.error;

    // NEW CODE: Detect error type
    if (errorData?.code === 'SESSION_EXPIRED') {
      // NEW CODE: Session expired - logout
      if (this.onLogout) {
        await this.onLogout();
      }
      return Promise.reject({
        code: 'SESSION_EXPIRED',
        sessionExpired: true,
        message: 'Session has expired'
      });
    }

    if (errorData?.code === 'TOKEN_EXPIRED') {
      // NEW CODE: Token expired - refresh and retry
      // Track retry count using a custom property on the error config
      // Note: This approach works with axios interceptors as the config object
      // is mutable and persists across interceptor calls
      const retryCount = (error.config as any)._retryCount || 0;
      if (retryCount >= maxRetries) {
        // NEW CODE: Max retries exceeded - logout
        if (this.onLogout) {
          await this.onLogout();
        }
        return Promise.reject({
          code: 'TOKEN_EXPIRED',
          message: 'Token refresh failed after retries'
        });
      }

      try {
        // NEW CODE: Refresh token (may throw if refresh fails)
        const newToken = await tokenManager.refreshToken();

        // NEW CODE: Retry original request with new token
        (error.config as any)._retryCount = retryCount + 1;
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return client.request(error.config);
      } catch (refreshError) {
        // NEW CODE: Token refresh failed - logout
        if (this.onLogout) {
          await this.onLogout();
        }
        return Promise.reject({
          code: 'TOKEN_EXPIRED',
          message: 'Token refresh failed',
          originalError: refreshError
        });
      }
    }

    // NEW CODE: Other 401 errors
    return Promise.reject(error);
  }
}
```

**Key Points:**
- ⚠️ No direct Firebase SDK usage (handles errors)
- ✅ NEW CODE: Error detection logic
- ✅ NEW CODE: Retry logic
- ✅ NEW CODE: Logout triggering

---

#### `packages/client/src/core/requestQueue.ts`

**Purpose:** Queue requests during token refresh

**Firebase SDK Usage:** ❌ No Firebase SDK (pure TypeScript)

```typescript
// NEW CODE: Request queue for token refresh
class RequestQueue {
  private queuedRequests: Array<{
    resolve: (token: string) => void;
    reject: (error: any) => void;
  }> = [];

  // NEW CODE: Queue a request to wait for token refresh
  queue(resolve: (token: string) => void, reject: (error: any) => void): void {
    this.queuedRequests.push({ resolve, reject });
  }

  // NEW CODE: Flush all queued requests with new token
  async flush(token: string): Promise<void> {
    const requests = [...this.queuedRequests];
    this.queuedRequests = [];
    requests.forEach(({ resolve }) => resolve(token));
  }

  // NEW CODE: Reject all queued requests (on refresh failure)
  async rejectAll(error: any): Promise<void> {
    const requests = [...this.queuedRequests];
    this.queuedRequests = [];
    requests.forEach(({ reject }) => reject(error));
  }
}
```

**Key Points:**
- ❌ No Firebase SDK (pure TypeScript)
- ✅ NEW CODE: Request queuing during token refresh
- ✅ NEW CODE: Error propagation on refresh failure

---

### Summary: Firebase SDK vs New Code

| Module | Firebase SDK Used | New Code Required |
|--------|------------------|-------------------|
| `firebase/admin.ts` | ✅ `firebase-admin/app`, `firebase-admin/firestore` | ✅ Initialization wrapper, credential loading |
| `sessionCache.ts` | ❌ None | ✅ All cache logic |
| `firestoreSync.ts` | ✅ `firebase-admin/firestore` | ✅ Throttling, batching logic |
| `sessionService.ts` | ✅ `firebase-admin/firestore` | ✅ Cache-first lookup, expiration logic |
| `authMiddleware.ts` | ⚠️ Indirect (via JWT verifier) | ✅ Session validation, error handling |
| `apiClient.ts` | ✅ `firebase/auth` | ✅ Interceptor setup |
| `tokenManager.ts` | ✅ `firebase/auth` | ✅ Queuing, refresh logic |
| `errorHandler.ts` | ❌ None | ✅ Error detection, retry logic |
| `requestQueue.ts` | ❌ None | ✅ Request queuing, error propagation |

**Key Insight:** Most Firebase SDK usage is for:
- **Server:** Firestore read/write operations
- **Client:** Token retrieval and refresh

All session management logic (inactivity tracking, expiration, caching) is **new custom code**.

## Data Models

### SessionInfo (Shared Type)

```typescript
interface SessionInfo {
  userId: string;              // Firebase user ID (document ID in Firestore)
  createdAt: Date;            // Session creation timestamp
  lastActivityAt: Date;       // Last activity timestamp (updated on each request)
  expiresAt: Date;            // Session expiration timestamp (lastActivityAt + inactivityTimeout)
}
```

### Firestore Document Structure

**Collection:** `user_sessions`  
**Document ID:** `{userId}`

```json
{
  "userId": "abc123",
  "createdAt": "2024-01-15T10:00:00Z",
  "lastActivityAt": "2024-01-15T14:30:00Z",
  "expiresAt": "2024-01-16T14:30:00Z"
}
```

**Document Size:** ~200 bytes per session

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: 'SESSION_EXPIRED' | 'TOKEN_EXPIRED' | 'AUTH_FAILED' | 'INTERNAL_ERROR' | 'SERVICE_UNAVAILABLE';
    message: string;
    requiresLogout: boolean;
    sessionExpired: boolean;    // true for SESSION_EXPIRED, false for TOKEN_EXPIRED
    timestamp: string;          // ISO 8601 timestamp
  };
}
```

**Error Response Examples:**

```typescript
// Session expired
{
  error: {
    code: 'SESSION_EXPIRED',
    message: 'Session has expired due to inactivity',
    requiresLogout: true,
    sessionExpired: true,
    timestamp: '2024-01-15T14:30:00.000Z'
  }
}

// Token expired
{
  error: {
    code: 'TOKEN_EXPIRED',
    message: 'Token has expired',
    requiresLogout: false,  // Client should refresh token
    sessionExpired: false,
    timestamp: '2024-01-15T14:30:00.000Z'
  }
}

// Service unavailable (Firestore down)
{
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'User sessions could not be validated',
    requiresLogout: false,
    sessionExpired: false,
    timestamp: '2024-01-15T14:30:00.000Z'
  }
}
```

## API Specifications

### Server Package API

#### SessionService

```typescript
class SessionService {
  constructor(
    cache: SessionCache,
    firestoreSync: FirestoreSync,
    firestore: Firestore,
    config: SessionServiceConfig
  );

  // Check if session is valid (cache-first, Firestore fallback)
  async isSessionValid(userId: string): Promise<boolean>;

  // Create new session for user
  async createSession(userId: string): Promise<void>;

  // Update last activity timestamp
  async updateLastActivity(userId: string): Promise<void>;

  // Clear session (logout)
  async clearSession(userId: string): Promise<void>;

  // Warmup cache from Firestore on startup
  async warmupCache(): Promise<void>;
}
```

#### Auth Middleware Factory

```typescript
function createAuthMiddleware(
  userTokenConfig: UserTokenConfig,
  googleConfig: GoogleAuthConfig,
  sessionService: SessionService,
  logger?: Logger
): RequestHandler;
```

### Client Package API

#### API Client Factory

```typescript
function createApiClient(config: ApiClientConfig): AxiosInstance;

interface ApiClientConfig {
  baseURL: string;
  auth: Auth;                    // Firebase Auth instance
  onLogout?: () => void | Promise<void>;
  maxRetries?: number;            // Default: 1
  timeout?: number;
}
```

#### React Hooks

```typescript
// Get API client instance
function useApiClient(): AxiosInstance;

// Monitor session expiration warnings
function useSessionMonitor(options?: {
  warningThresholdMinutes?: number;  // Default: 5 minutes before expiration
}): {
  warning: SessionWarning | null;
  timeRemaining: number;
};
```

## Performance and Scaling

### Cloud Run Considerations

#### Current Deployment

- **Service:** `stream-watcher-ui-proxy`
- **Platform:** Cloud Run (managed)
- **Region:** us-central1
- **Scaling:** Automatic (horizontal)

#### In-Memory Cache Impact

**Memory Footprint:**
- Per session: ~200 bytes
- 1,000 active sessions: ~200 KB
- 10,000 active sessions: ~2 MB

**Cloud Run Memory Limits:**
- Minimum: 128 MB
- Maximum: 32 GB
- Current allocation: Unknown (needs verification)

**Impact Assessment:**
- ✅ **Negligible:** Cache memory footprint is minimal
- ✅ **No sizing change needed:** Cache adds < 1% memory overhead
- ✅ **Scalable:** Memory usage scales linearly with active sessions

#### Horizontal Scaling Behavior

**Challenge:** In-memory cache is per-instance (not shared)

**Current Architecture:**
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Instance 1 │    │  Instance 2 │    │  Instance 3 │
│             │    │             │    │             │
│  Cache A    │    │  Cache B     │    │  Cache C    │
│  (User 1)   │    │  (User 2)   │    │  (User 3)   │
└─────────────┘    └─────────────┘    └─────────────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                         │
                  ┌──────▼──────┐
                  │  Firestore  │
                  │ (Source of  │
                  │   Truth)    │
                  └─────────────┘
```

**How It Works:**
1. **Cache Miss:** Instance checks Firestore (source of truth)
2. **Cache Update:** Instance updates its local cache
3. **Cache Hit:** Subsequent requests use local cache (fast path)
4. **Cache Invalidation:** On session expiration, cache entry removed

**Benefits:**
- ✅ **No shared state required:** Each instance is independent
- ✅ **Firestore as source of truth:** Consistency guaranteed
- ✅ **High cache hit rate:** User requests often hit same instance (load balancer affinity)
- ✅ **Fast fallback:** Cache miss → Firestore read (~50-100ms)

**Trade-offs:**
- ⚠️ **Cache duplication:** Same session may be cached in multiple instances
- ⚠️ **Cache warmup:** New instances start with empty cache
- ✅ **Acceptable:** Memory overhead is minimal, Firestore fallback is fast

#### Cache Warmup Strategy

**On Instance Startup:**
1. Query Firestore for active sessions (`expiresAt > now`)
2. Load sessions into cache
3. Continue serving requests (cache miss → Firestore during warmup)

**Performance Impact:**
- Warmup time: ~1-2 seconds for 1,000 sessions
- Requests during warmup: Use Firestore (acceptable latency)

#### Load Balancer Affinity

**Cloud Run Behavior:**
- Cloud Run does NOT guarantee session affinity
- Requests may hit different instances
- **Impact:** Cache hit rate may be lower than with sticky sessions

**Expected Cache Hit Rate:**
- **With affinity:** 90%+ (if user always hits same instance)
- **Without affinity:** 60-70% (realistic for Cloud Run)
- **Acceptable:** Firestore fallback is fast (~50-100ms)

### Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Session validation (cache hit) | < 10ms | In-memory lookup |
| Session validation (cache miss) | < 100ms | Firestore read |
| Cache hit rate | 60%+ | Realistic for Cloud Run |
| Firestore reads/day | < 50,000 | For 1,000 users, 10 req/hour |
| Firestore writes/day | < 300,000 | Throttled to 1 per 5 min per user |

## Security Considerations

### Session Security

1. **Session Creation:**
   - Only created after successful JWT verification
   - User ID extracted from verified JWT token
   - No user input in session creation

2. **Session Validation:**
   - Always verify JWT before checking session
   - Session check is additional layer, not replacement
   - Expired sessions cannot be reactivated

3. **Session Expiration:**
   - Automatic expiration after inactivity
   - No way to extend expired session
   - User must re-authenticate

### Token Security

1. **Token Refresh:**
   - Only refresh if session is valid
   - Refresh requires valid Firebase Auth session
   - Failed refresh triggers logout

2. **Error Handling:**
   - Never expose internal errors to client
   - Generic error messages for security
   - Detailed errors in server logs only

### Firestore Security

1. **Access Control:**
   - Server-side only access (Firebase Admin SDK)
   - No client-side access to session collection
   - Firestore security rules not required (server-only)

2. **Data Protection:**
   - Minimal data stored (userId, timestamps only)
   - No sensitive information in sessions
   - Encrypted in transit and at rest (Firestore default)

## Integration Considerations

### Current Codebase Integration

#### Backend Integration Points

**Current Error Handler (`packages/proxy/src/app.ts`):**
- ✅ Already handles `UserTokenVerificationError` and `AuthenticationError`
- ⚠️ **Gap:** Missing `sessionExpired` flag in error response
- **Fix:** New middleware adds `sessionExpired` flag to all 401 responses

**Current Auth Middleware (`packages/proxy/src/auth/middleware.ts`):**
- ✅ Already performs JWT verification
- **Integration:** New middleware wraps existing JWT verifier
- **Change:** Adds session validation step after JWT verification

#### Frontend Integration Points

**Current API Client (`src/services/api/config.ts`):**
- ⚠️ **Gap:** Logs out on ANY 401 with `requiresLogout=true`
- ⚠️ **Gap:** Does NOT distinguish `SESSION_EXPIRED` vs `TOKEN_EXPIRED`
- ⚠️ **Gap:** Does NOT refresh tokens
- **Fix:** Replace with `@rapidraptor/auth/client` which handles:
  - `SESSION_EXPIRED` → logout
  - `TOKEN_EXPIRED` → refresh token and retry

**Current Polling Hook (`src/hooks/useChannelStatus.ts`):**
- ⚠️ **Gap:** Continues polling after 401 errors
- **Fix:** Check for `SESSION_EXPIRED` or `TOKEN_EXPIRED` codes and stop polling
- **Implementation:**
  ```typescript
  // In useChannelStatus hook
  catch (error) {
    if (error.code === 'SESSION_EXPIRED' || error.code === 'TOKEN_EXPIRED') {
      clearInterval(intervalRef.current);
      setError(error);
      return; // Stop polling
    }
    // Handle other errors
  }
  ```

### Migration Checklist

**Backend:**
- [ ] Replace `packages/proxy/src/auth/middleware.ts` with `@rapidraptor/auth/server` middleware
- [ ] Initialize `SessionService` in `packages/proxy/src/index.ts`
- [ ] Update error handler to include `sessionExpired` flag (if not already added by middleware)
- [ ] Add Firestore environment variables

**Frontend:**
- [ ] Replace `src/services/api/config.ts` with `@rapidraptor/auth/client`
- [ ] Update `src/hooks/useChannelStatus.ts` to stop polling on auth errors
- [ ] Test token refresh flow
- [ ] Test session expiration flow

## Implementation Details

### Session Cache Implementation

**Data Structure:**
```typescript
class SessionCache {
  private sessions: Map<string, SessionInfo>;
  private inactivityTimeout: number;

  get(userId: string): SessionInfo | null;
  set(userId: string, session: SessionInfo): void;
  isExpired(userId: string): boolean;
  clear(userId: string): void;
  clearExpired(): void;
}
```

**Eviction Strategy:**
- Manual expiration check on `isExpired()`
- Periodic cleanup of expired sessions (optional)
- No size limit (memory is minimal)

**Race Condition Handling:**
- Session creation uses Firestore transactions (`ensureSession()` method)
- Prevents duplicate session creation on concurrent requests
- Transaction ensures atomicity: check existence → create if missing

### Firestore Sync Implementation

**Throttling:**
- Minimum 5 minutes between writes per user
- Queue writes and batch every 5 minutes
- Immediate write on session creation

**Batch Strategy:**
```typescript
class FirestoreSync {
  private writeQueue: Map<string, SessionInfo>;
  private throttleMs: number;
  private lastWriteTime: Map<string, number>;

  queueWrite(userId: string, session: SessionInfo): void;
  async batchSync(): Promise<void>;
}
```

### Token Refresh Implementation

**Request Queuing:**
```typescript
class TokenManager {
  private refreshPromise: Promise<string> | null;
  private requestQueue: Array<() => Promise<any>>;

  async getToken(forceRefresh: boolean): Promise<string>;
  async refreshToken(): Promise<string>;
  private async flushQueue(token: string): Promise<void>;
}
```

**Flow:**
1. First request with expired token → Start refresh
2. Concurrent requests → Queue and wait for refresh
3. Refresh completes → Flush queue with new token
4. All requests retry with new token

## Testing Strategy

### Unit Tests

**Server Package:**
- SessionCache: get, set, isExpired, clear
- FirestoreSync: queueWrite, batchSync, throttling
- SessionService: isSessionValid, createSession, updateLastActivity
- AuthMiddleware: session validation, error responses

**Client Package:**
- API Client: token injection, error handling
- TokenManager: refresh, queuing
- ErrorHandler: SESSION_EXPIRED vs TOKEN_EXPIRED detection

### Integration Tests

**Server Package:**
- Full flow: JWT verification → session check → activity update
- Firestore emulator for session persistence
- Cache warmup from Firestore

**Client Package:**
- Full request/response cycle with MSW
- Token refresh and retry flow
- Concurrent request handling

### Performance Tests

- Cache hit/miss latency
- Firestore read/write performance
- Concurrent request handling
- Memory usage under load

## Deployment Considerations

### Cloud Run Configuration

**Environment Variables:**
```bash
SESSION_INACTIVITY_TIMEOUT_HOURS=24
SESSION_FIRESTORE_SYNC_INTERVAL_MS=300000
SESSION_FIRESTORE_WRITE_THROTTLE_MS=300000
FIRESTORE_SESSIONS_COLLECTION=user_sessions
FIREBASE_PROJECT_ID=${PROJECT_ID}
FIREBASE_PRIVATE_KEY=${PRIVATE_KEY}
FIREBASE_CLIENT_EMAIL=${CLIENT_EMAIL}
```

**Memory Allocation:**
- Current: No change needed (cache is minimal)
- Monitor: Track memory usage after deployment
- Scale: Adjust if needed (unlikely)

### Migration Strategy

**Phase 1: Library Development**
- Build `@rapidraptor/auth` library
- No production impact

**Phase 2: Backend Deployment**
- Deploy proxy with session management
- Sessions created automatically on first request
- Old sessions ignored (no migration needed)

**Phase 3: Frontend Deployment**
- Deploy frontend with new error handling
- Users may need to re-login (expected)

**Rollback Plan:**
- Backend: Revert to previous version (sessions ignored)
- Frontend: Revert to previous version
- No data cleanup required

### Monitoring

**Key Metrics:**
- Session creation rate
- Session expiration rate
- Cache hit rate
- Firestore read/write operations
- Error rates (SESSION_EXPIRED vs TOKEN_EXPIRED)
- Memory usage

**Alerts:**
- High Firestore operation count (cost monitoring)
- Low cache hit rate (< 50%)
- High error rate
- Memory usage approaching limits

---

**Document Status:** Draft - Ready for Review

**Next Steps:**
1. Review and approve technical design
2. Begin implementation following TDD approach
3. Set up Firestore emulator for testing
4. Create monitoring dashboards

