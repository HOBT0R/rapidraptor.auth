# Integration Tests for @rapidraptor/auth

## Overview

These integration tests serve a dual purpose:

1. **Validation** - Ensure the library works correctly end-to-end with real Firebase services
2. **Documentation** - Provide clear, working examples for developers implementing the library

The tests use the Firebase emulator to provide a realistic testing environment without requiring production Firebase credentials. Each test demonstrates real-world usage patterns and best practices.

## Prerequisites

### Required Software

1. **Node.js** (v18 or higher)
2. **Firebase CLI** - Install globally:
   ```bash
   npm install -g firebase-tools
   ```

### Firebase Emulator Setup

The integration tests require the Firebase emulator to be running. The emulator provides local instances of:
- Firebase Authentication
- Cloud Firestore

#### Starting the Emulator

From the repository root:

```bash
npm run emulator:start
```

This starts the emulator with Auth and Firestore on their default ports:
- Auth: `localhost:9099`
- Firestore: `localhost:8080`

#### Stopping the Emulator

```bash
npm run emulator:stop
```

Or press `Ctrl+C` in the terminal where the emulator is running.

### Environment Variables

The tests automatically set these environment variables when running:
- `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`
- `FIRESTORE_EMULATOR_HOST=localhost:8080`
- `FIREBASE_PROJECT_ID=test-project`

You don't need to set these manually - they're configured in the test setup.

## Running Tests

### Run All Integration Tests

```bash
npm run test:integration
```

This will:
1. Build the shared and server packages
2. Run all integration tests in `__tests__/integration/`

### Run Tests in Watch Mode

```bash
npm run test:integration:watch
```

This watches for file changes and re-runs tests automatically.

### Run a Specific Test File

```bash
npm run build:shared && npm run build:server
npx vitest run __tests__/integration/auth.integration.test.ts
```

## Reading Tests as Examples

The integration tests are designed to be read as implementation guides. Here's how to use them:

### 1. Understanding Test Structure

Each test file demonstrates a complete setup pattern:

- **`firebase-setup.ts`** - Shows how to initialize Firebase Admin for emulator/production
- **`test-server.ts`** - Shows complete Express server setup with auth middleware
- **`test-utils.ts`** - Shows common utility patterns (user creation, token retrieval)
- **`auth.integration.test.ts`** - Shows end-to-end usage scenarios

### 2. Mapping Test Scenarios to Real-World Use Cases

#### Test 1: Login and Token Creation
**Real-world scenario:** User logs into your app and makes their first API request

**What it shows:**
- How sessions are automatically created
- The flow from client login to server session creation
- What to expect on first authenticated request

**Apply to your app:**
```typescript
// Client-side (your React app)
const user = await signInWithEmailAndPassword(auth, email, password);
const token = await user.getIdToken();

// Server automatically creates session on first request
// No additional code needed!
```

#### Test 2: Create New User Session
**Real-world scenario:** New user's first API call after signup

**What it shows:**
- Session creation is automatic and idempotent
- Session structure and initial values

**Apply to your app:**
- No special handling needed - the library handles it automatically

#### Test 3: Update Last Activity Time
**Real-world scenario:** User makes multiple API requests over time

**What it shows:**
- Activity tracking is automatic
- Expiration time extends with activity

**Apply to your app:**
- The library handles this automatically - just use the auth middleware

#### Test 4: Expired User Session
**Real-world scenario:** User returns after 24 hours of inactivity

**What it shows:**
- How expired sessions are detected
- Error response format
- User must logout and login again

**Apply to your app:**
```typescript
// Your ApiClient automatically handles this
// On 401 SESSION_EXPIRED, it triggers onLogout callback
const apiClient = createApiClient({
  baseURL: '/api',
  auth,
  onLogout: async () => {
    await signOut(auth);
    window.location.href = '/login';
  },
});
```

#### Test 5: Block Old Tokens
**Real-world scenario:** User logs out, then tries to use an old token

**What it shows:**
- Token revocation mechanism
- Security feature preventing token reuse

**Apply to your app:**
- Handled automatically - old tokens are rejected after logout

#### Test 6: Log Out and Delete Session
**Real-world scenario:** User clicks logout button

**What it shows:**
- Logout flow and session cleanup
- Logout record creation for token revocation

**Apply to your app:**
```typescript
// Client-side logout
await apiClient.logout();

// This calls POST /auth/logout which clears the session
```

### 3. Understanding Test Patterns

#### Server Setup Pattern

See `test-server.ts` for the complete server setup:

```typescript
// 1. Initialize Firebase Admin
await initializeFirebaseAdmin();
const firestore = getFirestoreInstance();

// 2. Create SessionService
const sessionService = createSessionService(firestore, {
  // Configuration options
});

// 3. Create Token Verifier
const tokenVerifier = new JoseTokenVerifier({
  jwksUri: '...',
  issuer: '...',
  audience: '...',
});

// 4. Create Auth Middleware
const authMiddleware = createAuthMiddleware(tokenVerifier, sessionService);

// 5. Apply to routes
app.get('/api/protected', authMiddleware, handler);
```

#### Client Token Retrieval Pattern

See `test-utils.ts` `getAuthToken()` function:

```typescript
// This mirrors what happens in your React app
const userCredential = await signInWithEmailAndPassword(auth, email, password);
const token = await userCredential.user.getIdToken();
```

In your app, the `ApiClient` handles this automatically.

## Test Structure Guide

### File Organization

```
__tests__/integration/
├── README.md                    # This file
├── firebase-setup.ts            # Firebase emulator configuration
├── test-server.ts               # Express server setup example
├── test-utils.ts                # Helper functions and utilities
└── auth.integration.test.ts     # Main test suite
```

### Key Files Explained

#### `firebase-setup.ts`
- **Purpose:** Configure Firebase Admin for emulator
- **Real-world equivalent:** Your production Firebase Admin initialization
- **Key functions:**
  - `initializeFirebaseEmulator()` - Sets up emulator connection
  - `getEmulatorAuth()` - Get Auth instance
  - `getEmulatorFirestore()` - Get Firestore instance

#### `test-server.ts`
- **Purpose:** Complete Express server setup example
- **Real-world equivalent:** Your application's server setup
- **Key patterns:**
  - SessionService configuration
  - Token verifier setup
  - Middleware application
  - Route protection

#### `test-utils.ts`
- **Purpose:** Utility functions for testing
- **Real-world equivalent:** Common patterns you might use in your app
- **Key functions:**
  - `createTestUser()` - Create users (for testing)
  - `getAuthToken()` - Get tokens (mirrors client-side flow)
  - `cleanupTestUser()` - Clean up (testing only)

#### `auth.integration.test.ts`
- **Purpose:** End-to-end test scenarios
- **Real-world equivalent:** Usage examples for each feature
- **Each test shows:**
  - Setup steps
  - Expected behavior
  - Assertions and validations

## Common Patterns Demonstrated

### 1. Server Setup Pattern

The tests show the recommended server setup pattern:

```typescript
// Initialize Firebase
await initializeFirebaseAdmin();
const firestore = getFirestoreInstance();

// Create services
const sessionService = createSessionService(firestore);
const tokenVerifier = new JoseTokenVerifier({ /* config */ });

// Create middleware
const authMiddleware = createAuthMiddleware(tokenVerifier, sessionService);
const logoutHandler = createLogoutHandler(sessionService);

// Apply to routes
app.use('/api', authMiddleware);
app.post('/auth/logout', authMiddleware, logoutHandler);
```

### 2. Client Token Retrieval Pattern

The tests demonstrate how clients get tokens:

```typescript
// User logs in
const userCredential = await signInWithEmailAndPassword(auth, email, password);

// Get token for API requests
const token = await userCredential.user.getIdToken();

// Token is automatically included by ApiClient
const response = await apiClient.get('/api/protected');
```

### 3. Error Handling Pattern

The tests show error response formats:

```typescript
// On session expiration
{
  error: {
    code: 'SESSION_EXPIRED',
    message: 'Session has expired due to inactivity',
    requiresLogout: true,
    sessionExpired: true,
    timestamp: '2024-01-15T10:00:00Z'
  }
}

// Your ApiClient handles this automatically
// It calls onLogout callback when requiresLogout is true
```

### 4. Session Management Pattern

Sessions are managed automatically:

- **Creation:** Automatic on first authenticated request
- **Activity Updates:** Automatic on each request
- **Expiration:** Automatic after inactivity timeout
- **Cleanup:** Automatic on logout

You don't need to manually manage sessions - the library handles everything.

## Best Practices

### Configuration Recommendations

#### Development Environment
```typescript
const sessionService = createSessionService(firestore, {
  inactivityTimeoutMs: 1 * 60 * 60 * 1000, // 1 hour (faster testing)
  firestoreWriteThrottleMs: 1 * 60 * 1000, // 1 minute
  firestoreCollectionName: 'dev_user_sessions',
});
```

#### Production Environment
```typescript
const sessionService = createSessionService(firestore, {
  // Use defaults (24 hours, 5 minutes)
  // Or override with production values
  inactivityTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
  firestoreWriteThrottleMs: 5 * 60 * 1000, // 5 minutes
  firestoreCollectionName: 'user_sessions',
});
```

### Security Considerations

1. **Token Verification:** Always use JWKS URI in production (not skipVerification)
2. **HTTPS:** Always use HTTPS in production (emulator uses HTTP for testing)
3. **Credentials:** Never commit Firebase credentials to version control
4. **Token Storage:** Tokens are handled automatically by Firebase SDK (secure storage)

### Performance Considerations

1. **Session Cache:** The library uses in-memory cache for fast lookups
2. **Firestore Throttling:** Writes are throttled to reduce Firestore costs
3. **Token Refresh:** Tokens are automatically refreshed when expired (if session is valid)

### Production Deployment Patterns

1. **Environment Variables:** Use environment variables for configuration
2. **Service Account:** Use service account file or environment variables for Firebase Admin
3. **Monitoring:** Monitor session creation/expiration rates
4. **Error Handling:** Implement proper error handling and logging

## Troubleshooting

### Emulator Not Running

**Error:** `Failed to connect to Firebase Auth emulator`

**Solution:** Start the emulator:
```bash
npm run emulator:start
```

### Port Already in Use

**Error:** `Port 9099 (or 8080) is already in use`

**Solution:** 
1. Stop other Firebase emulator instances
2. Or change ports in `firebase.json` (if you have one)

### Tests Timeout

**Error:** Tests timeout waiting for session expiration

**Solution:** 
- Check that emulator is running
- Increase timeout in `vitest.config.ts` if needed
- Verify test configuration timeouts are reasonable

### Build Errors

**Error:** Cannot find module '@rapidraptor/auth-server'

**Solution:** Build packages first:
```bash
npm run build:shared
npm run build:server
```

## Additional Resources

- [Main README](../../README.md) - Library documentation
- [Solution Design](../../solution-design-session-management.md) - Architecture overview
- [Technical Design](../../technical-design-session-management.md) - Implementation details
- [Firebase Emulator Docs](https://firebase.google.com/docs/emulator-suite) - Official Firebase emulator documentation

## Contributing

When adding new integration tests:

1. Follow the existing test structure
2. Add comprehensive comments explaining the scenario
3. Document real-world use cases
4. Include setup/teardown for test isolation
5. Update this README if adding new patterns

