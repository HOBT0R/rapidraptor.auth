# @rapidraptor/auth

Unified authentication library for session management and token expiration handling.

## Overview

This library provides both client-side and server-side components for managing user sessions, handling token expiration, and providing a seamless user experience with automatic token refresh and session expiration.

## Packages

- **@rapidraptor/auth-shared** - Shared types and constants
- **@rapidraptor/auth-client** - Frontend library for React applications
- **@rapidraptor/auth-server** - Backend library for Node.js/Express applications

## Features

- Automatic session expiration after 24 hours of inactivity
- Proper distinction between session expiration and token expiration
- Automatic token refresh when session is valid
- Improved user experience with transparent token refresh
- Server-side session tracking in Firestore
- In-memory cache for fast session validation

## Installation

### Client Package

```bash
npm install @rapidraptor/auth-client axios firebase
```

### Server Package

```bash
npm install @rapidraptor/auth-server firebase-admin
```

## Usage

### Client-Side

#### Basic Usage

```typescript
import { createApiClient } from '@rapidraptor/auth/client';
import { auth } from './firebase';
import { signOut } from 'firebase/auth';

const apiClient = createApiClient({
  baseURL: '/api',
  auth,
  onLogout: async () => {
    await signOut(auth);
    window.location.href = '/login';
  },
});

// Use apiClient for all API requests
const response = await apiClient.get('/users');
```

#### Customizing Client Configuration

All client configuration options are optional and will use sensible defaults if not provided:

```typescript
import { createApiClient, DEFAULTS } from '@rapidraptor/auth/client';

const apiClient = createApiClient({
  baseURL: '/api',
  auth,
  onLogout: async () => {
    await signOut(auth);
  },
  // Override defaults as needed
  maxRetries: 3, // Default: DEFAULTS.MAX_RETRIES (1)
  timeout: 60000, // Default: DEFAULTS.API_TIMEOUT_MS (30000)
});
```

### Server-Side

#### Basic Usage (Recommended)

The easiest way to set up server-side session management is using the `createSessionService` helper:

```typescript
import {
  createAuthMiddleware,
  createSessionService,
  initializeFirebaseAdmin,
  getFirestoreInstance,
  JoseTokenVerifier,
} from '@rapidraptor/auth/server';

// Initialize Firebase Admin
await initializeFirebaseAdmin();
const firestore = getFirestoreInstance();

// Create SessionService with defaults
const sessionService = createSessionService(firestore);

// Create token verifier (default implementation)
const tokenVerifier = new JoseTokenVerifier({
  jwksUri: 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  issuer: 'https://securetoken.google.com/YOUR_PROJECT_ID',
  audience: 'YOUR_PROJECT_ID',
});

// Create middleware
const authMiddleware = createAuthMiddleware(
  tokenVerifier,
  sessionService,
  logger
);

// Use in Express app
app.use('/api', authMiddleware);
```

#### Environment-Specific Configuration

You can override defaults for different environments (development, staging, production):

```typescript
import {
  createSessionService,
  initializeFirebaseAdmin,
  getFirestoreInstance,
  DEFAULTS,
} from '@rapidraptor/auth/server';

await initializeFirebaseAdmin();
const firestore = getFirestoreInstance();

// Development: Shorter timeouts for faster testing
const devConfig = {
  inactivityTimeoutMs: 1 * 60 * 60 * 1000, // 1 hour instead of 24
  firestoreWriteThrottleMs: 1 * 60 * 1000, // 1 minute instead of 5
  firestoreCollectionName: 'dev_user_sessions', // Separate collection
};

// Staging: Medium timeouts
const stagingConfig = {
  inactivityTimeoutMs: 12 * 60 * 60 * 1000, // 12 hours
  firestoreWriteThrottleMs: 3 * 60 * 1000, // 3 minutes
  firestoreCollectionName: 'staging_user_sessions',
};

// Production: Use defaults (24 hours, 5 minutes)
const prodConfig = {
  // All values use DEFAULTS
};

// Select config based on environment
const env = process.env.NODE_ENV || 'development';
const config =
  env === 'production'
    ? prodConfig
    : env === 'staging'
      ? stagingConfig
      : devConfig;

const sessionService = createSessionService(firestore, config);
```

#### Advanced: Manual Service Construction

For more control, you can construct services manually:

```typescript
import {
  SessionCache,
  FirestoreSync,
  SessionService,
  initializeFirebaseAdmin,
  getFirestoreInstance,
  DEFAULTS,
} from '@rapidraptor/auth/server';

await initializeFirebaseAdmin();
const firestore = getFirestoreInstance();

// Configure with environment variables or custom values
const inactivityTimeout = parseInt(
  process.env.SESSION_INACTIVITY_TIMEOUT_MS || String(DEFAULTS.INACTIVITY_TIMEOUT_MS),
  10,
);
const throttleMs = parseInt(
  process.env.FIRESTORE_WRITE_THROTTLE_MS || String(DEFAULTS.FIRESTORE_WRITE_THROTTLE_MS),
  10,
);
const collectionName =
  process.env.FIRESTORE_SESSIONS_COLLECTION || DEFAULTS.FIRESTORE_SESSIONS_COLLECTION_NAME;

// Create components
const cache = new SessionCache(inactivityTimeout);
const firestoreSync = new FirestoreSync(firestore, throttleMs, collectionName);
const sessionService = new SessionService(
  cache,
  firestoreSync,
  firestore,
  inactivityTimeout,
  collectionName,
);
```

## Configuration Reference

### Default Values

All defaults are available from `@rapidraptor/auth-shared`:

```typescript
import { DEFAULTS } from '@rapidraptor/auth-shared';

// DEFAULTS.INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000 (24 hours)
// DEFAULTS.FIRESTORE_WRITE_THROTTLE_MS = 5 * 60 * 1000 (5 minutes)
// DEFAULTS.FIRESTORE_SESSIONS_COLLECTION_NAME = 'user_sessions'
// DEFAULTS.MAX_RETRIES = 1
// DEFAULTS.API_TIMEOUT_MS = 30 * 1000 (30 seconds)
```

### Configuration Options

#### Client Configuration (`ApiClientConfig`)

- `baseURL` (required): Base URL for API requests
- `auth` (required): Firebase Auth instance
- `onLogout` (optional): Callback when logout is required
- `maxRetries` (optional): Max retries for token refresh (default: `DEFAULTS.MAX_RETRIES`)
- `timeout` (optional): Request timeout in milliseconds (default: `DEFAULTS.API_TIMEOUT_MS`)

#### Server Configuration (`SessionServiceConfig`)

- `inactivityTimeoutMs` (optional): Session inactivity timeout in milliseconds (default: `DEFAULTS.INACTIVITY_TIMEOUT_MS`)
- `firestoreWriteThrottleMs` (optional): Throttle period for Firestore writes in milliseconds (default: `DEFAULTS.FIRESTORE_WRITE_THROTTLE_MS`)
- `firestoreCollectionName` (optional): Firestore collection name for sessions (default: `DEFAULTS.FIRESTORE_SESSIONS_COLLECTION_NAME`)

#### Token Verifier Configuration (`TokenVerifierConfig`)

The default `JoseTokenVerifier` supports multiple configuration options:

```typescript
import { JoseTokenVerifier } from '@rapidraptor/auth/server';

// Option 1: JWKS URI (recommended for OAuth providers like Firebase, Auth0)
const verifier = new JoseTokenVerifier({
  jwksUri: 'https://www.googleapis.com/service_accounts/v1/jwk/...',
  issuer: 'https://securetoken.google.com/YOUR_PROJECT_ID',
  audience: 'YOUR_PROJECT_ID',
});

// Option 2: Static public key (for custom JWT issuers)
const verifier = new JoseTokenVerifier({
  publicKey: '-----BEGIN PUBLIC KEY-----\n...', // Inline PEM
  // OR
  publicKey: 'file:///path/to/public-key.pem', // File path
  issuer: 'https://your-issuer.com',
  audience: 'your-audience',
});

// Option 3: Skip verification (development/test only)
const verifier = new JoseTokenVerifier({
  skipVerification: true,
  mockUser: {
    sub: 'dev-user',
    email: 'dev@example.com',
    name: 'Development User',
  },
});
```

**Configuration Options:**
- `skipVerification` (optional): Skip verification and return mock user (default: `false`)
- `publicKey` (optional): Static public key in PEM format or file path (prefix with `file://`)
- `jwksUri` (optional): JWKS URI for remote key lookup
- `issuer` (optional): Expected JWT issuer (iss claim)
- `audience` (optional): Expected JWT audience (aud claim)
- `mockUser` (optional): Mock user to return when `skipVerification` is true

### Environment Variable Example

You can use environment variables to configure the library:

```bash
# .env.development
SESSION_INACTIVITY_TIMEOUT_MS=3600000
FIRESTORE_WRITE_THROTTLE_MS=60000
FIRESTORE_SESSIONS_COLLECTION=dev_user_sessions

# .env.production
SESSION_INACTIVITY_TIMEOUT_MS=86400000
FIRESTORE_WRITE_THROTTLE_MS=300000
FIRESTORE_SESSIONS_COLLECTION=user_sessions
```

```typescript
const sessionService = createSessionService(firestore, {
  inactivityTimeoutMs: parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_MS || '86400000', 10),
  firestoreWriteThrottleMs: parseInt(process.env.FIRESTORE_WRITE_THROTTLE_MS || '300000', 10),
  firestoreCollectionName: process.env.FIRESTORE_SESSIONS_COLLECTION || 'user_sessions',
});
```

## Documentation

See the [Solution Design](./solution-design-session-management.md) and [Technical Design](./technical-design-session-management.md) documents for detailed architecture and implementation details.

## Release Process

This library uses automated versioning and releases. When a PR is merged to the `main` branch:

1. **CI checks run** - All tests (unit + integration) must pass
2. **Version bump** - Patch version is automatically incremented (e.g., 0.1.0 → 0.1.1)
3. **Git tag** - A version tag is created and pushed (e.g., `v0.1.1`)
4. **npm publish** - All packages are published to npm (optional, requires NPM_TOKEN secret)
5. **GitHub release** - A GitHub release is created with changelog

**Note**: npm publishing is optional. If `NPM_TOKEN` is not configured, the workflow will skip npm publishing and only create git tags and GitHub releases.

### Manual Version Bumps

For major or minor version bumps:

```bash
# Bump minor version
npm run version:bump minor

# Bump major version
npm run version:bump major

# Set specific version
npm run version:bump 1.2.3
```

Then commit and push the changes. The automated release workflow will handle the rest.

### Skipping a Release

To skip versioning for a merge, include `[skip release]` or `[no version]` in the commit message.

### Version Management

All packages share the same version number for simplicity. To verify versions are synchronized:

```bash
npm run version:check
```

See [CHANGELOG.md](./CHANGELOG.md) for a list of all releases and changes.

## License

Private - Internal use only

