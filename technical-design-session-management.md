---
title: Technical Design - Session Management and Token Expiration
version: 1.3
status: Draft
date: 2025-02-21
---

**Version History:**
- **v1.3**: Independent session IDs — document ID is sessionId (UUID); lookup by userId query; fixes logout/re-login
- **v1.2**: Added JWT revocation tracking to prevent re-authentication after logout
- **v1.1**: Added logout handler and client-side logout method implementation
- **v1.0**: Initial technical design for session management and token expiration

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
│   │   │   │   ├── authMiddleware.ts   # Express middleware factory
│   │   │   │   └── logoutHandler.ts    # Logout handler factory
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
  private writeQueue: Map<string, { sessionId: string; session: SessionInfo }>;
  private throttleMs: number;
  private lastWriteTime: Map<string, number>;

  constructor(firestore: Firestore, throttleMs: number) {
    this.firestore = firestore;
    this.writeQueue = new Map();
    this.throttleMs = throttleMs;
    this.lastWriteTime = new Map();
  }

  // NEW CODE: Queue write with throttling (keyed by userId; session includes sessionId)
  queueWrite(userId: string, session: SessionInfo): void {
    const now = Date.now();
    const lastWrite = this.lastWriteTime.get(userId) || 0;

    if (now - lastWrite < this.throttleMs) {
      this.writeQueue.set(userId, { sessionId: session.sessionId, session });
      return;
    }

    this.writeQueue.set(userId, { sessionId: session.sessionId, session });
    this.lastWriteTime.set(userId, now);
  }

  // NEW CODE: Batch sync all queued writes (document ID = sessionId)
  async batchSync(): Promise<void> {
    if (this.writeQueue.size === 0) return;

    const batch = this.firestore.batch();
    const collection = this.firestore.collection('user_sessions');

    for (const [, { sessionId, session }] of this.writeQueue.entries()) {
      const docRef = collection.doc(sessionId);
      batch.set(docRef, {
        sessionId: session.sessionId,
        userId: session.userId,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        expiresAt: session.expiresAt
      });
    }

    await batch.commit();
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
import { randomUUID } from 'crypto';
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

  // NEW CODE: Find active session by userId (query; document ID is sessionId)
  private async findActiveSessionByUserId(userId: string): Promise<SessionInfo | null> {
    const snapshot = await this.firestore
      .collection('user_sessions')
      .where('userId', '==', userId)
      .where('expiresAt', '>', new Date())
      .orderBy('lastActivityAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    const data = snapshot.docs[0].data();
    return this.parseFirestoreDocument(data);
  }

  // NEW CODE: Check session validity (cache-first, then query by userId)
  async isSessionValid(userId: string): Promise<boolean> {
    if (this.cache.get(userId) && !this.cache.isExpired(userId)) {
      return true;
    }

    const session = await this.findActiveSessionByUserId(userId);
    if (!session || new Date() > session.expiresAt) {
      return false;
    }

    this.cache.set(userId, session);
    return true;
  }

  // NEW CODE: Create new session (sessionId = UUID)
  async createSession(userId: string): Promise<string> {
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.inactivityTimeout);

    const session: SessionInfo = {
      sessionId,
      userId,
      createdAt: now,
      lastActivityAt: now,
      expiresAt
    };

    this.cache.set(userId, session);

    const docRef = this.firestore.collection('user_sessions').doc(sessionId);
    await docRef.set({
      sessionId: session.sessionId,
      userId: session.userId,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt
    });
    return sessionId;
  }

  // NEW CODE: Update last activity
  async updateLastActivity(userId: string): Promise<void> {
    const session = this.cache.get(userId);
    if (!session) {
      // NEW CODE: Fallback to Firestore if not in cache
      const isValid = await this.isSessionValid(userId);
      if (!isValid) return;
      // Session now in cache after isSessionValid call
    }

    // NEW CODE: Update cache immediately
    const updatedSession: SessionInfo = {
      ...this.cache.get(userId)!,
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + this.inactivityTimeout)
    };
    this.cache.set(userId, updatedSession);

    // NEW CODE: Queue Firestore write (throttled)
    this.firestoreSync.queueWrite(userId, updatedSession);
  }

  // NEW CODE: Clear session (logout) — query all sessions for userId, delete by sessionId
  async clearSession(userId: string): Promise<void> {
    this.cache.clear(userId);

    const logoutRef = this.firestore.collection('user_logouts').doc(userId);
    await logoutRef.set({
      userId,
      loggedOutAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    });

    // Query all active sessions for this user, delete each by sessionId
    const snapshot = await this.firestore
      .collection('user_sessions')
      .where('userId', '==', userId)
      .get();
    for (const doc of snapshot.docs) {
      await doc.ref.delete();
    }
  }

  // NEW CODE: Check if JWT token was issued before logout
  async isTokenRevoked(userId: string, tokenIssuedAt: Date): Promise<boolean> {
    // FIREBASE SDK: Check logout timestamp
    const logoutRef = this.firestore
      .collection('user_logouts')
      .doc(userId);
    const doc = await logoutRef.get();
    
    if (!doc.exists) {
      return false; // No logout recorded - token is valid
    }
    
    const data = doc.data();
    if (!data) {
      return false;
    }
    
    // NEW CODE: Check if logout record is still valid (within 1 hour)
    const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
    if (new Date() >= expiresAt) {
      return false; // Logout record expired - token is valid
    }
    
    // NEW CODE: Check if token was issued BEFORE logout
    const loggedOutAt = data.loggedOutAt?.toDate ? data.loggedOutAt.toDate() : new Date(data.loggedOutAt);
    return tokenIssuedAt < loggedOutAt;
  }

  // NEW CODE: Warmup cache from Firestore (doc ID = sessionId; cache key = userId)
  async warmupCache(): Promise<void> {
    const collection = this.firestore.collection('user_sessions');
    const now = new Date();
    const snapshot = await collection.where('expiresAt', '>', now).get();

    for (const doc of snapshot.docs) {
      const session = this.parseFirestoreDocument(doc.data());
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

---

#### `packages/server/src/middleware/authMiddleware.ts`

**Purpose:** Express middleware for session validation

**Firebase SDK Usage:** ⚠️ Indirect (uses existing JWT verifier)

```typescript
// NEW CODE: Auth middleware with session validation
import { RequestHandler } from 'express';
import { decodeJwt } from 'jose'; // For extracting iat from JWT
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
      
      // NEW CODE: Decode JWT to extract iat (issued at) timestamp
      // This is needed to check if token was issued before logout
      let tokenIssuedAt: Date;
      try {
        // Decode JWT payload to get iat (issued at time in seconds)
        const decoded = jose.decodeJwt(token);
        tokenIssuedAt = new Date((decoded.iat || 0) * 1000); // Convert seconds to milliseconds
      } catch (error) {
        // If we can't decode, assume token is invalid
        throw new AuthenticationError('Invalid token format');
      }
      
      // EXISTING CODE: Verify JWT (uses Firebase Admin SDK)
      const user = await userTokenVerifier.verify(token);

      // NEW CODE: Check session validity
      const isValid = await sessionService.isSessionValid(user.sub);

      if (!isValid) {
        // NEW CODE: Check if token was issued before logout
        const isRevoked = await sessionService.isTokenRevoked(user.sub, tokenIssuedAt);
        if (isRevoked) {
          // NEW CODE: Token was issued before logout - reject request
          return res.status(401).json({
            error: {
              code: 'SESSION_EXPIRED',
              message: 'This token was issued before logout. Please log in again.',
              requiresLogout: true,
              sessionExpired: true
            }
          });
        }

        // NEW CODE: Check if session exists (might need creation)
        const sessionExists = await sessionService.sessionExists(user.sub);
        if (!sessionExists) {
          // NEW CODE: Create session on first request (token is valid - issued after logout or no logout recorded)
          await sessionService.createSession(user.sub);
        } else {
          // NEW CODE: Session expired
          return res.status(401).json({
            error: {
              code: 'SESSION_EXPIRED',
              message: 'Session has expired due to inactivity',
              requiresLogout: true,
              sessionExpired: true
            }
          });
        }
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
            sessionExpired: false,
            requiresLogout: error.isExpired
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
- ✅ NEW CODE: JWT decoding to extract `iat` (issued at) timestamp
- ✅ NEW CODE: Session validation logic
- ✅ NEW CODE: Token revocation check (compare JWT `iat` with logout timestamp)
- ✅ NEW CODE: Session creation on first request (only if token not revoked)
- ✅ NEW CODE: Activity tracking
- ✅ NEW CODE: Error response formatting

---

#### `packages/server/src/middleware/logoutHandler.ts`

**Purpose:** Express middleware/handler for clearing sessions on logout

**Firebase SDK Usage:** ❌ No direct Firebase SDK usage (uses SessionService)

```typescript
// NEW CODE: Logout handler for clearing sessions
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { SessionService } from '../session/sessionService';
import type { Logger } from '../types/middleware';

export function createLogoutHandler(
  sessionService: SessionService,
  logger?: Logger
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // NEW CODE: Extract user from authenticated request (set by auth middleware)
      const user = req.user;
      
      if (!user?.sub) {
        // NEW CODE: User not authenticated - return error
        return res.status(401).json({
          error: {
            code: 'AUTH_FAILED',
            message: 'Authentication required for logout',
            requiresLogout: false,
            sessionExpired: false,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // NEW CODE: Clear session (idempotent - safe to call multiple times)
      await sessionService.clearSession(user.sub);

      const requestLogger = req.logger || logger;
      requestLogger?.info?.('Session cleared on logout', {
        event: 'session_cleared',
        userId: user.sub,
        correlationId: req.correlationId,
      });

      // NEW CODE: Return success response
      res.status(200).json({
        message: 'Logged out successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // NEW CODE: Handle errors gracefully
      const requestLogger = req.logger || logger;
      requestLogger?.error?.('Logout handler error', {
        event: 'logout_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.sub,
        correlationId: req.correlationId,
      });
      next(error);
    }
  };
}
```

**Key Points:**
- ❌ No direct Firebase SDK usage (delegates to SessionService)
- ✅ NEW CODE: Session clearing logic
- ✅ NEW CODE: Idempotent operation (safe to call multiple times)
- ✅ NEW CODE: Requires authentication (uses auth middleware)
- ✅ NEW CODE: Error handling and logging

**Integration Note:** This handler must be used after the auth middleware to ensure `req.user` is set.

---

### Client Package Modules

#### `packages/client/src/core/apiClient.ts`

**Purpose:** Axios client with token injection, error handling, and logout method

**Firebase SDK Usage:** ✅ Uses `firebase/auth`

```typescript
// NEW CODE: API client factory with logout method
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Auth } from 'firebase/auth';
import { TokenManager } from './tokenManager';
import { ErrorHandler } from './errorHandler';

// NEW CODE: Extended AxiosInstance with logout method
export interface ApiClient extends AxiosInstance {
  logout: () => Promise<void>;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const { baseURL, auth, onLogout, maxRetries = 1, logoutEndpoint = '/auth/logout' } = config;

  const client = axios.create({ baseURL }) as ApiClient;
  const tokenManager = new TokenManager(auth);
  const errorHandler = new ErrorHandler(onLogout);

  // NEW CODE: Request interceptor - inject token
  client.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      // FIREBASE SDK: Get current user token
      const token = await tokenManager.getToken(false);
      if (token && config.headers) {
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

  // NEW CODE: Logout method - clears server session and client tokens
  client.logout = async (): Promise<void> => {
    try {
      // NEW CODE: Attempt to clear server-side session
      // Get token for logout request
      const token = await tokenManager.getToken(false);
      if (token) {
        try {
          // NEW CODE: Call logout endpoint to clear server session
          await client.post(logoutEndpoint, {}, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
        } catch (error) {
          // NEW CODE: Log but don't fail - graceful degradation
          // If server logout fails, still proceed with client-side logout
          console.warn('Failed to clear server session:', error);
        }
      }
    } catch (error) {
      // NEW CODE: Log but don't fail - graceful degradation
      console.warn('Failed to get token for logout:', error);
    }

    // NEW CODE: Always perform client-side logout (even if server logout failed)
    if (onLogout) {
      await onLogout();
    }
  };

  return client;
}
```

**Key Points:**
- ✅ Uses Firebase Auth SDK (`firebase/auth`)
- ✅ NEW CODE: Interceptor setup
- ✅ NEW CODE: Token injection logic
- ✅ NEW CODE: Logout method that clears both server and client sessions
- ✅ NEW CODE: Graceful degradation (client logout proceeds even if server logout fails)
- ✅ NEW CODE: Idempotent logout (safe to call multiple times)

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

        // NEW CODE: Flush queued requests
        await this.requestQueue.flush(token);

        return token;
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
import { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { TokenManager } from './tokenManager';
import { ERROR_CODES } from '@rapidraptor/auth-shared';

class ErrorHandler {
  private onLogout?: () => void | Promise<void>;

  constructor(onLogout?: () => void | Promise<void>) {
    this.onLogout = onLogout;
  }

  // NEW CODE: Perform logout (calls callback if provided)
  private async performLogout(): Promise<void> {
    if (this.onLogout) {
      await this.onLogout();
    }
  }

  // NEW CODE: Handle 401 errors
  async handle401Error(
    error: AxiosError,
    tokenManager: TokenManager,
    client: AxiosInstance,
    maxRetries: number
  ): Promise<any> {
    const errorData = (error.response?.data as any)?.error;

    // NEW CODE: Detect error type - SESSION_EXPIRED
    if (errorData?.code === ERROR_CODES.SESSION_EXPIRED) {
      // NEW CODE: Session expired - logout
      await this.performLogout();
      return Promise.reject({
        code: ERROR_CODES.SESSION_EXPIRED,
        sessionExpired: true,
        message: 'Session has expired',
      });
    }

    // NEW CODE: Detect error type - TOKEN_EXPIRED
    if (errorData?.code !== ERROR_CODES.TOKEN_EXPIRED) {
      // NEW CODE: Other 401 errors - reject as-is
      return Promise.reject(error);
    }

    // NEW CODE: Token expired - refresh and retry
    const config = error.config as InternalAxiosRequestConfig & { _retryCount?: number };
    const retryCount = config._retryCount || 0;

    // NEW CODE: Check max retries
    if (retryCount >= maxRetries) {
      // NEW CODE: Max retries exceeded - logout
      await this.performLogout();
      return Promise.reject({
        code: ERROR_CODES.TOKEN_EXPIRED,
        message: 'Token refresh failed after retries',
      });
    }

    // NEW CODE: Attempt token refresh and retry
    try {
      // FIREBASE SDK: Refresh token (may throw if refresh fails)
      const newToken = await tokenManager.refreshToken();

      // NEW CODE: Retry original request with new token
      config._retryCount = retryCount + 1;
      if (config.headers) {
        config.headers.Authorization = `Bearer ${newToken}`;
      }
      return client.request(config);
    } catch (refreshError) {
      // NEW CODE: Token refresh failed - logout
      await this.performLogout();
      return Promise.reject({
        code: ERROR_CODES.TOKEN_EXPIRED,
        message: 'Token refresh failed',
        originalError: refreshError,
      });
    }
  }
}
```

**Key Points:**
- ⚠️ No direct Firebase SDK usage (handles errors)
- ✅ NEW CODE: Error detection logic
- ✅ NEW CODE: Retry logic
- ✅ NEW CODE: Logout triggering (via performLogout helper)
- ✅ NEW CODE: Uses shared error codes from @rapidraptor/auth-shared

---

### Summary: Firebase SDK vs New Code

| Module | Firebase SDK Used | New Code Required |
|--------|------------------|-------------------|
| `firebase/admin.ts` | ✅ `firebase-admin/app`, `firebase-admin/firestore` | ✅ Initialization wrapper, credential loading |
| `sessionCache.ts` | ❌ None | ✅ All cache logic |
| `firestoreSync.ts` | ✅ `firebase-admin/firestore` | ✅ Throttling, batching logic |
| `sessionService.ts` | ✅ `firebase-admin/firestore` | ✅ Cache-first lookup, expiration logic, logout timestamp tracking |
| `authMiddleware.ts` | ⚠️ Indirect (via JWT verifier) | ✅ Session validation, JWT iat extraction, token revocation checking, error handling |
| `logoutHandler.ts` | ❌ None | ✅ Session clearing on logout, logout timestamp tracking |
| `apiClient.ts` | ✅ `firebase/auth` | ✅ Interceptor setup, logout method |
| `tokenManager.ts` | ✅ `firebase/auth` | ✅ Queuing, refresh logic |
| `errorHandler.ts` | ❌ None | ✅ Error detection, retry logic, logout triggering |

**Key Insight:** Most Firebase SDK usage is for:
- **Server:** Firestore read/write operations
- **Client:** Token retrieval and refresh

All session management logic (inactivity tracking, expiration, caching) is **new custom code**.

## Data Models

### SessionInfo (Shared Type)

```typescript
interface SessionInfo {
  sessionId: string;          // Independent session identifier (UUID); document ID in Firestore
  userId: string;             // From JWT sub claim (for lookup; sessions are associated with users)
  createdAt: Date;            // Session creation timestamp
  lastActivityAt: Date;      // Last activity timestamp (updated on each request)
  expiresAt: Date;           // Session expiration timestamp (lastActivityAt + inactivityTimeout)
}
```

### Firestore Document Structure

**Collection:** `user_sessions`  
**Document ID:** `{sessionId}` (UUID; independent of userId)

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "abc123",
  "createdAt": "2024-01-15T10:00:00Z",
  "lastActivityAt": "2024-01-15T14:30:00Z",
  "expiresAt": "2024-01-16T14:30:00Z"
}
```

**Lookup:** Query by `userId` and `expiresAt > now`, `limit(1)`, with optional `orderBy('lastActivityAt', 'desc')` for deterministic choice when multiple active sessions exist. Composite index required: `(userId, expiresAt)` or `(userId, expiresAt, lastActivityAt desc)`.

**Document Size:** ~250 bytes per session

### User Logouts Document Structure

**Collection:** `user_logouts`  
**Document ID:** `{userId}`

```json
{
  "userId": "abc123",
  "loggedOutAt": "2024-01-15T15:00:00Z",
  "expiresAt": "2024-01-15T16:00:00Z"
}
```

**Purpose:** Tracks when users logged out to prevent re-authentication with JWTs issued before logout.  
**TTL:** 1 hour (matches typical JWT lifetime)  
**Document Size:** ~150 bytes per logout record  
**Auto-cleanup:** Documents expire after 1 hour and can be cleaned up via Firestore TTL policies (optional)  
**Logic:** When a JWT is verified, its `iat` (issued at) timestamp is compared with `loggedOutAt`. If `iat < loggedOutAt`, the token is rejected as it was issued before logout.

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: 'SESSION_EXPIRED' | 'TOKEN_EXPIRED' | 'AUTH_FAILED' | 'INTERNAL_ERROR';
    message: string;
    requiresLogout: boolean;
    sessionExpired: boolean;    // true for SESSION_EXPIRED, false for TOKEN_EXPIRED
    timestamp: string;
  };
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

  // Check if JWT token was issued before logout
  async isTokenRevoked(userId: string, tokenIssuedAt: Date): Promise<boolean>;

  // Create new session for user
  async createSession(userId: string): Promise<void>;

  // Update last activity timestamp
  async updateLastActivity(userId: string): Promise<void>;

  // Clear session (logout) - also marks session as revoked
  async clearSession(userId: string): Promise<void>;

  // Warmup cache from Firestore on startup
  async warmupCache(): Promise<void>;
}
```

#### Auth Middleware Factory

```typescript
function createAuthMiddleware(
  userTokenVerifier: UserTokenVerifier,
  sessionService: SessionService,
  logger?: Logger
): RequestHandler;
```

#### Logout Handler Factory

```typescript
function createLogoutHandler(
  sessionService: SessionService,
  logger?: Logger
): RequestHandler;
```

**Usage Example:**
```typescript
import { createAuthMiddleware, createLogoutHandler, SessionService } from '@rapidraptor/auth/server';

// Create session service
const sessionService = new SessionService(/* ... */);

// Create auth middleware (protects routes)
const authMiddleware = createAuthMiddleware(userTokenVerifier, sessionService, logger);

// Create logout handler (clears sessions)
const logoutHandler = createLogoutHandler(sessionService, logger);

// Apply middleware
app.use('/api', authMiddleware);  // Protect all /api routes

// Expose logout endpoint
app.post('/auth/logout', authMiddleware, logoutHandler);  // Requires auth, then clears session
```

### Client Package API

#### API Client Factory

```typescript
interface ApiClient extends AxiosInstance {
  logout: () => Promise<void>;
}

function createApiClient(config: ApiClientConfig): ApiClient;

interface ApiClientConfig {
  baseURL: string;
  auth: Auth;                    // Firebase Auth instance
  onLogout?: () => void | Promise<void>;
  maxRetries?: number;            // Default: 1
  timeout?: number;
  logoutEndpoint?: string;        // Default: '/auth/logout'
}
```

**Usage Example:**
```typescript
import { createApiClient } from '@rapidraptor/auth/client';
import { signOut } from 'firebase/auth';
import { auth } from './firebase';

const apiClient = createApiClient({
  baseURL: '/api',
  auth,
  onLogout: async () => {
    // Clear Firebase Auth tokens
    await signOut(auth);
    // Redirect to login
    window.location.href = '/login';
  },
  logoutEndpoint: '/auth/logout',  // Optional: defaults to '/auth/logout'
});

// Use for API calls
const response = await apiClient.get('/users');

// Call logout when user clicks logout button
await apiClient.logout();  // Clears server session + client tokens
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
| Token revocation check (when session missing) | < 100ms | Firestore read to user_logouts |
| Cache hit rate | 60%+ | Realistic for Cloud Run |
| Firestore reads/day | < 50,000 | For 1,000 users, 10 req/hour (includes revocation checks) |
| Firestore writes/day | < 300,000 | Throttled to 1 per 5 min per user |
| Logout writes/day | < 1,000 | One per logout (much lower than session writes) |

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

4. **Session Clearing (Logout):**
   - Only authenticated users can clear their own sessions
   - Logout endpoint requires valid JWT token
   - Session immediately removed from cache and Firestore
   - **Logout timestamp tracking**: Logout time stored in `user_logouts` collection
   - **JWT revocation protection**: Prevents use of JWTs issued before logout
   - Idempotent operation (safe to call multiple times)
   - No way to reactivate cleared session without re-authentication

5. **JWT Revocation Limitation:**
   - **Problem**: JWTs cannot be revoked once issued (they're stateless)
   - **Solution**: Track logout timestamps and compare with JWT's `iat` (issued at) claim
   - **Protection Logic**: 
     - Extract `iat` from JWT payload
     - Compare `iat` with `loggedOutAt` timestamp
     - If `iat < loggedOutAt` → reject token (old token from before logout)
     - If `iat >= loggedOutAt` → allow token (new token from after logout)
   - **User Experience**: Users can log in again immediately and get new JWTs
   - **Trade-off**: Small performance cost (one extra Firestore read per request when session doesn't exist)
   - **Auto-cleanup**: Logout records expire after 1 hour (can use Firestore TTL policies)

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

### Logout Implementation

**Server-Side Logout Handler:**
```typescript
function createLogoutHandler(
  sessionService: SessionService,
  logger?: Logger
): RequestHandler;
```

**Flow:**
1. User initiates logout → Frontend calls `apiClient.logout()`
2. Client sends `POST /auth/logout` with JWT token
3. Auth middleware verifies JWT and sets `req.user`
4. Logout handler extracts `userId` from `req.user.sub`
5. SessionService clears session:
   - Immediately removes from in-memory cache
   - Stores logout timestamp in `user_logouts` collection (1 hour TTL)
   - Synchronously deletes session document from Firestore
6. Returns 200 OK response
7. Client receives response and calls `onLogout` callback
8. `onLogout` callback:
   - Calls Firebase `signOut()` to clear client tokens
   - Redirects to login page

**JWT Revocation Protection:**
- After logout, if user still has old JWT token (issued before logout) and makes request:
  - JWT verification passes (token signature is valid, not expired)
  - Session validation fails (session was deleted)
  - Token revocation check: Extract `iat` from JWT, compare with `loggedOutAt`
  - If `iat < loggedOutAt` → Request rejected with `SESSION_EXPIRED` error
  - New session is NOT created (prevents re-authentication with old token)
- If user logs in again (gets new JWT):
  - New JWT has `iat` >= `loggedOutAt` (issued after logout)
  - Token revocation check passes
  - New session is created (user can authenticate with new token)
- Logout record expires after 1 hour (matches typical JWT lifetime)
- This addresses the JWT limitation: cannot revoke tokens, but can reject tokens issued before logout

**Key Design Decisions:**
- **Idempotent**: Logout can be called multiple times safely (no error if session already cleared)
- **Graceful Degradation**: Client-side logout proceeds even if server logout fails
- **Security**: Logout endpoint requires authentication (uses auth middleware)
- **JWT Revocation Protection**: Logout timestamp tracking prevents use of JWTs issued before logout
- **User Experience**: Users can log in again immediately and get new JWTs (not blocked by revocation)
- **Performance**: Cache clearing is immediate; Firestore deletion is synchronous for security
- **Revocation TTL**: 1 hour expiration matches typical JWT lifetime (balances security and storage)
- **Error Handling**: Server errors are logged but don't prevent client-side logout

**Client-Side Logout Method:**
```typescript
interface ApiClient extends AxiosInstance {
  logout: () => Promise<void>;
}
```

**Flow:**
1. `apiClient.logout()` is called
2. Attempts to get current token
3. If token exists, calls logout endpoint (`POST /auth/logout`)
4. If server logout fails, logs warning but continues
5. Always calls `onLogout` callback (provided by application)
6. `onLogout` callback handles:
   - Firebase `signOut()`
   - Redirect to login
   - Any other cleanup

**Integration Requirements:**
- Applications must expose logout endpoint using logout handler
- Applications must provide `onLogout` callback when creating API client
- Logout endpoint should be protected by auth middleware
- **Security Note**: While revocation tracking prevents re-authentication, applications should still ensure `onLogout` callback clears Firebase Auth tokens for complete client-side cleanup

## Testing Strategy

### Unit Tests

**Server Package:**
- SessionCache: get, set, isExpired, clear
- FirestoreSync: queueWrite, batchSync, throttling
- SessionService: isSessionValid, isTokenRevoked, createSession, updateLastActivity, clearSession
- AuthMiddleware: session validation, JWT iat extraction, token revocation checking, error responses
- LogoutHandler: session clearing, logout timestamp tracking, error handling

**Client Package:**
- API Client: token injection, error handling, logout method
- TokenManager: refresh, queuing
- ErrorHandler: SESSION_EXPIRED vs TOKEN_EXPIRED detection, logout triggering

### Integration Tests

**Server Package:**
- Full flow: JWT verification → session check → activity update
- Logout flow: JWT verification → session clearing → logout timestamp tracking → response
- Token revocation flow: JWT verification → extract iat → session check → compare iat with logout timestamp → reject if token issued before logout
- Firestore emulator for session persistence and logout timestamp tracking
- Cache warmup from Firestore

**Client Package:**
- Full request/response cycle with MSW
- Token refresh and retry flow
- Logout flow: server session clearing + client token clearing
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
FIRESTORE_LOGOUTS_COLLECTION=user_logouts
LOGOUT_TTL_HOURS=1
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

**v1.3 Independent Session IDs (clean slate):**
- Firestore document ID changes from `userId` to `sessionId` (UUID). No data migration script; use a clean slate.
- Before deploying: optionally delete or truncate the `user_sessions` collection (emulator or production).
- After deploy: new sessions are created with the new structure on next login. Create Firestore composite index on `(userId, expiresAt)` or `(userId, expiresAt, lastActivityAt)` as required by the active-session query.

**Phase 3: Frontend Deployment**
- Deploy frontend with new error handling and logout method
- Users may need to re-login (expected)
- Logout functionality available immediately

**Rollback Plan:**
- Backend: Revert to previous version (sessions ignored)
- Frontend: Revert to previous version
- No data cleanup required

### Monitoring

**Key Metrics:**
- Session creation rate
- Session expiration rate
- Session clearing rate (logout)
- Token revocation check rate (Firestore reads for user_logouts)
- Cache hit rate
- Firestore read/write operations (including user_logouts collection)
- Error rates (SESSION_EXPIRED vs TOKEN_EXPIRED)
- Logout success/failure rates
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

