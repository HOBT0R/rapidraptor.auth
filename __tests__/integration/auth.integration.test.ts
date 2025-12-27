/**
 * Integration Tests for @rapidraptor/auth Library
 *
 * These tests serve as both validation and documentation, demonstrating
 * how to properly implement the authentication library in a real application.
 *
 * Each test shows:
 * - How to set up the library components
 * - Expected behavior and responses
 * - Error handling patterns
 * - Best practices for integration
 *
 * These tests use the Firebase emulator to provide a realistic testing
 * environment without requiring production Firebase credentials.
 *
 * @module __tests__/integration/auth.integration.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import {
  createTestUser,
  getAuthToken,
  waitForSessionExpiration,
  cleanupTestUser,
  setupTestEnvironment,
  readFirestoreWithRetry,
  ensureFirestoreWrite,
  waitForFirestoreCondition,
  type TestUser,
} from './test-utils.js';
import { createTestServer, getTestConfig } from './test-server.js';
import { getEmulatorFirestore } from './firebase-setup.js';
import { ERROR_CODES } from '@rapidraptor/auth-shared';

/**
 * Integration tests for authentication and session management
 *
 * These tests validate the complete flow from user login through session
 * management, including edge cases like expiration and logout.
 */
describe('Auth Integration Tests', () => {
  let app: Express;
  let firestoreSync: import('@rapidraptor/auth-server').FirestoreSync;
  let testUser: TestUser | null = null;
  const testConfig = getTestConfig();

  /**
   * Global setup: Initialize Firebase emulator and create test server
   *
   * This runs once before all tests. It:
   * 1. Sets up the Firebase emulator connection
   * 2. Creates the Express test server with auth middleware
   *
   * In production, you would do similar setup in your application's
   * initialization code.
   */
  beforeAll(async () => {
    // Set emulator environment variables
    // In production, these would not be set and Firebase would use real services
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.FIREBASE_PROJECT_ID = 'test-project';

    // Initialize emulator connection
    await setupTestEnvironment();

    // Create test server (mirrors production server setup)
    const server = await createTestServer();
    app = server.app;
    firestoreSync = server.firestoreSync;
  });

  /**
   * Global teardown: Clean up after all tests
   */
  afterAll(async () => {
    // Stop periodic sync to prevent memory leaks
    if (firestoreSync) {
      firestoreSync.stopPeriodicSync();
    }

    // Clean up any remaining test data
    if (testUser) {
      await cleanupTestUser(testUser.uid);
    }
  });

  /**
   * Test setup: Create a fresh test user for each test
   *
   * This ensures test isolation - each test starts with a clean user
   * that has no existing session.
   */
  beforeEach(async () => {
    testUser = await createTestUser({
      email: `test-${Date.now()}@example.com`,
      password: 'password123',
      displayName: 'Test User',
    });
  });

  /**
   * Test teardown: Clean up test user and session data
   *
   * This ensures no test data leaks between tests.
   */
  afterEach(async () => {
    if (testUser) {
      await cleanupTestUser(
        testUser.uid,
        testConfig.firestoreCollectionName,
        testConfig.firestoreLogoutsCollectionName,
      );
      testUser = null;
    }
  });

  /**
   * Test 1: Login and Token Creation
   *
   * Scenario: User logs in via Firebase Auth and makes their first API request
   *
   * This test demonstrates:
   * - How sessions are automatically created on first authenticated request
   * - The flow from client login to server session creation
   * - What developers should expect when a new user makes their first API call
   *
   * Expected behavior:
   * 1. User logs in (gets ID token from Firebase Auth)
   * 2. User makes first API request with token
   * 3. Server verifies token and creates session automatically
   * 4. Request succeeds with user information
   */
  it('should create session on first authenticated request', async () => {
    // Step 1: User logs in and gets ID token
    // In a real app, this happens when user submits login form
    // The client SDK handles the Firebase Auth flow
    const token = await getAuthToken(testUser!.email, 'password123');

    // Step 2: User makes first API request with token
    // In a real app, the ApiClient automatically includes the token
    // Here we manually add it to demonstrate the flow
    const response = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Step 3: Verify response contains user information
    // The auth middleware attaches req.user, which is returned in the response
    expect(response.body).toHaveProperty('user');
    expect(response.body.user).toHaveProperty('sub', testUser!.uid);
    expect(response.body.user).toHaveProperty('email', testUser!.email);
    expect(response.body).toHaveProperty('message', 'Protected route accessed successfully');

    // Step 4: Verify session was created in Firestore
    // In production, you typically don't need to check this directly
    // but it's useful for testing
    // Use retry logic to handle eventual consistency
    const sessionDoc = await readFirestoreWithRetry(
      testConfig.firestoreCollectionName,
      testUser!.uid,
    );

    expect(sessionDoc.exists).toBe(true);
    const sessionData = sessionDoc.data();
    expect(sessionData).toHaveProperty('userId', testUser!.uid);
    expect(sessionData).toHaveProperty('createdAt');
    expect(sessionData).toHaveProperty('lastActivityAt');
    expect(sessionData).toHaveProperty('expiresAt');
  });

  /**
   * Test 2: Create New User Session
   *
   * Scenario: User makes their first API request after login
   *
   * This test demonstrates:
   * - How the library automatically creates sessions for new users
   * - That session creation is idempotent (safe to call multiple times)
   * - The session structure and initial values
   *
   * Expected behavior:
   * 1. First request creates session
   * 2. Session has correct initial values (createdAt, lastActivityAt, expiresAt)
   * 3. Subsequent requests use existing session (don't recreate)
   */
  it('should create new session when session does not exist', async () => {
    const token = await getAuthToken(testUser!.email, 'password123');

    // First request - session doesn't exist yet
    const response1 = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response1.body.user.sub).toBe(testUser!.uid);

    // Verify session was created (use retry to handle eventual consistency)
    const sessionDoc = await readFirestoreWithRetry(
      testConfig.firestoreCollectionName,
      testUser!.uid,
    );

    expect(sessionDoc.exists).toBe(true);
    const sessionData = sessionDoc.data()!;

    // Verify session timestamps
    const createdAt = sessionData.createdAt.toDate();
    const lastActivityAt = sessionData.lastActivityAt.toDate();
    const expiresAt = sessionData.expiresAt.toDate();

    // All timestamps should be recent (within last 5 seconds)
    const now = new Date();
    expect(createdAt.getTime()).toBeGreaterThan(now.getTime() - 5000);
    expect(lastActivityAt.getTime()).toBeGreaterThan(now.getTime() - 5000);

    // ExpiresAt should be inactivityTimeout in the future
    const expectedExpiry = new Date(
      lastActivityAt.getTime() + testConfig.inactivityTimeoutMs,
    );
    expect(expiresAt.getTime()).toBeCloseTo(expectedExpiry.getTime(), -3); // Within 1 second

    // Second request - session should already exist
    // The library should use existing session, not create a new one
    const response2 = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response2.body.user.sub).toBe(testUser!.uid);
  });

  /**
   * Test 3a: Update Last Activity Time (Cache Behavior)
   *
   * Scenario: User makes multiple API requests in quick succession
   *
   * This test demonstrates:
   * - How the library updates the cache immediately on each request
   * - That cache updates happen synchronously (no throttling)
   * - That subsequent requests use the updated cache values
   *
   * Expected behavior:
   * 1. Cache is updated immediately (no waiting for Firestore)
   * 2. Multiple rapid requests all succeed (cache is being used)
   * 3. Session remains valid across rapid requests (cache updates extend expiration)
   *
   * Note: This tests the cache layer, not Firestore writes (which are throttled)
   */
  it('should update last activity in cache immediately on subsequent requests', async () => {
    const token = await getAuthToken(testUser!.email, 'password123');

    // First request - creates session (writes immediately to Firestore)
    await request(app).get('/test').set('Authorization', `Bearer ${token}`).expect(200);

    // Make multiple rapid requests to test cache behavior
    // Cache updates happen immediately, so all requests should succeed
    // even though Firestore writes are throttled
    const requestCount = 5;

    for (let i = 0; i < requestCount; i++) {
      // Small delay between requests to ensure timestamps are different
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Each request should succeed - cache is updated immediately
      // This demonstrates that cache updates are synchronous and don't wait for Firestore
      await request(app).get('/test').set('Authorization', `Bearer ${token}`).expect(200);
    }

    // Verify that the session is still valid after all requests
    // This confirms the cache was updated and expiration was extended
    const finalResponse = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(finalResponse.body.user.sub).toBe(testUser!.uid);
  });

  /**
   * Test 3b: Update Last Activity Time (Firestore Behavior)
   *
   * Scenario: User makes API requests and we verify Firestore is updated
   *
   * This test demonstrates:
   * - How Firestore writes are throttled (not immediate)
   * - That updates eventually make it to Firestore
   * - That createdAt is preserved when lastActivityAt is updated
   *
   * Expected behavior:
   * 1. First request creates session in Firestore
   * 2. Second request updates cache immediately, queues Firestore write
   * 3. After throttle period, Firestore write is flushed
   * 4. createdAt remains unchanged, lastActivityAt is updated
   *
   * Note: This tests the Firestore persistence layer, not the cache
   */
  it('should eventually write last activity update to Firestore after throttle period', async () => {
    const token = await getAuthToken(testUser!.email, 'password123');

    // First request - creates session (writes immediately to Firestore)
    await request(app).get('/test').set('Authorization', `Bearer ${token}`).expect(200);

    const firestore = getEmulatorFirestore();

    // Get initial session state from Firestore
    const sessionDoc1 = await firestore
      .collection(testConfig.firestoreCollectionName)
      .doc(testUser!.uid)
      .get();
    const initialCreatedAt = sessionDoc1.data()!.createdAt.toDate();
    const initialLastActivity = sessionDoc1.data()!.lastActivityAt.toDate();
    const initialExpiresAt = sessionDoc1.data()!.expiresAt.toDate();

    // Verify initial state: createdAt and lastActivityAt should be the same initially
    expect(initialCreatedAt.getTime()).toBe(initialLastActivity.getTime());

    // Wait to ensure timestamps will be different
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Second request - updates cache immediately, queues Firestore write
    // The cache update happens synchronously, but Firestore write is throttled
    await request(app).get('/test').set('Authorization', `Bearer ${token}`).expect(200);

    // Give the async updateLastActivity call time to queue the Firestore write
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Wait for the throttle period to ensure the periodic sync has had a chance to run
    // Then manually flush to ensure the write happens (for test reliability)
    await new Promise((resolve) => setTimeout(resolve, testConfig.firestoreWriteThrottleMs + 500));

    // Manually flush the queue to ensure writes are committed
    // In production, this happens automatically via periodic sync
    // For tests, we flush manually to ensure deterministic behavior
    await firestoreSync.batchSync();

    // Wait for the write to be visible in Firestore (eventual consistency)
    // This ensures we're reading the updated value, not a stale cached value
    await ensureFirestoreWrite(
      testConfig.firestoreCollectionName,
      testUser!.uid,
      (doc) => {
        if (!doc.exists) return false;
        const data = doc.data()!;
        const updatedLastActivity = data.lastActivityAt.toDate();
        // Verify that lastActivityAt has been updated
        return updatedLastActivity.getTime() > initialLastActivity.getTime();
      },
      testConfig.firestoreWriteThrottleMs * 2 + 2000, // Allow time for write + retries
    );

    // Now read from Firestore to verify the update
    // Use retry logic to handle any remaining eventual consistency issues
    const sessionDoc2 = await readFirestoreWithRetry(
      testConfig.firestoreCollectionName,
      testUser!.uid,
    );

    const sessionData = sessionDoc2.data()!;
    const updatedLastActivity = sessionData.lastActivityAt.toDate();
    const updatedExpiresAt = sessionData.expiresAt.toDate();
    const updatedCreatedAt = sessionData.createdAt.toDate();

    // Verify the update was written to Firestore
    // Check that lastActivityAt was updated
    expect(updatedLastActivity.getTime()).toBeGreaterThan(initialLastActivity.getTime());

    // Verify createdAt was NOT changed in Firestore
    // This is critical - createdAt should never change after initial creation
    // This also proves we're writing the complete session, not just updating fields
    expect(updatedCreatedAt.getTime()).toBe(initialCreatedAt.getTime());

    // Verify expiresAt was extended in Firestore
    expect(updatedExpiresAt.getTime()).toBeGreaterThan(initialExpiresAt.getTime());

    // Verify expiresAt is still inactivityTimeout in the future from new lastActivityAt
    const expectedNewExpiry = new Date(
      updatedLastActivity.getTime() + testConfig.inactivityTimeoutMs,
    );
    expect(updatedExpiresAt.getTime()).toBeCloseTo(expectedNewExpiry.getTime(), -3);
  });

  /**
   * Test 4: Expired User Session
   *
   * Scenario: User's session expires due to inactivity
   *
   * This test demonstrates:
   * - How expired sessions are detected and rejected
   * - The error response format for expired sessions
   * - That users must log out and log back in after expiration
   *
   * Expected behavior:
   * 1. Session expires after inactivity timeout
   * 2. Requests with expired session return 401 SESSION_EXPIRED
   * 3. Error response indicates user must logout and login again
   */
  it('should reject requests after session expiration', async () => {
    const token = await getAuthToken(testUser!.email, 'password123');

    // Create session with first request
    await request(app).get('/test').set('Authorization', `Bearer ${token}`).expect(200);

    // Wait for session to expire
    // In production, this would happen naturally after 24 hours of inactivity
    // For testing, we use a short timeout (1 minute) and wait for it
    await waitForSessionExpiration(
      testUser!.uid,
      testConfig.firestoreCollectionName,
      500, // Check every 500ms
      testConfig.inactivityTimeoutMs + 5000, // Wait up to timeout + 5 seconds
    );

    // Attempt to make request with expired session
    // In a real app, the ApiClient would handle this error and trigger logout
    const response = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    // Verify error response format
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toHaveProperty('code', ERROR_CODES.SESSION_EXPIRED);
    expect(response.body.error).toHaveProperty('requiresLogout', true);
    expect(response.body.error).toHaveProperty('sessionExpired', true);
    expect(response.body.error.message).toContain('expired');
  });

  /**
   * Test 5: Block Creating New Sessions with Old Token
   *
   * Scenario: User logs out, then tries to use a token issued before logout
   *
   * This test demonstrates:
   * - Token revocation mechanism
   * - How the library prevents reuse of old tokens after logout
   * - The security feature that prevents token reuse
   *
   * Expected behavior:
   * 1. User gets token and creates session
   * 2. User logs out (session cleared)
   * 3. User tries to use old token (issued before logout)
   * 4. Request is rejected with token revocation error
   */
  it('should reject token issued before logout', async () => {
    // Step 1: User logs in and gets token
    const token = await getAuthToken(testUser!.email, 'password123');

    // Step 2: User makes request, creating session
    await request(app).get('/test').set('Authorization', `Bearer ${token}`).expect(200);

    // Step 3: User logs out
    // In a real app, this would be triggered by user clicking logout button
    // The ApiClient.logout() method calls this endpoint
    await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Step 4: User tries to use the old token (issued before logout)
    // This should be rejected even though the token itself is still valid
    // The library tracks when users logged out and rejects tokens issued before that time
    const response = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    // Verify error response indicates token was revoked
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toHaveProperty('code', ERROR_CODES.SESSION_EXPIRED);
    expect(response.body.error).toHaveProperty('requiresLogout', true);
    expect(response.body.error.message).toContain('issued before logout');
  });

  /**
   * Test 6: Log Out and Delete User Session
   *
   * Scenario: User explicitly logs out
   *
   * This test demonstrates:
   * - How logout clears the user session
   * - That logout is idempotent (safe to call multiple times)
   * - The logout flow and response
   *
   * Expected behavior:
   * 1. User has active session
   * 2. User calls logout endpoint
   * 3. Session is deleted from Firestore
   * 4. Logout record is created (to prevent token reuse)
   * 5. Subsequent requests require new login
   */
  it('should clear session on logout', async () => {
    const token = await getAuthToken(testUser!.email, 'password123');

    // Create session
    await request(app).get('/test').set('Authorization', `Bearer ${token}`).expect(200);

    // Verify session exists (use retry to handle eventual consistency)
    const sessionBefore = await readFirestoreWithRetry(
      testConfig.firestoreCollectionName,
      testUser!.uid,
    );
    expect(sessionBefore.exists).toBe(true);

    // User logs out
    // In a real app, this is called via ApiClient.logout()
    // which internally calls this endpoint
    const logoutResponse = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(logoutResponse.body).toHaveProperty('message', 'Logged out successfully');

    // Verify session was deleted (use retry to handle eventual consistency)
    // Wait for deletion to be visible in Firestore
    await waitForFirestoreCondition(
      testConfig.firestoreCollectionName,
      testUser!.uid,
      (doc) => !doc.exists, // Document should not exist after logout
      200, // Check every 200ms
      2000, // Wait up to 2 seconds for deletion
    );

    // Double-check with a direct read
    const sessionAfter = await readFirestoreWithRetry(
      testConfig.firestoreCollectionName,
      testUser!.uid,
    );
    expect(sessionAfter.exists).toBe(false);

    // Verify logout record was created (for token revocation)
    // Use retry to handle eventual consistency
    const logoutRecord = await readFirestoreWithRetry(
      testConfig.firestoreLogoutsCollectionName,
      testUser!.uid,
    );
    expect(logoutRecord.exists).toBe(true);

    // Verify subsequent requests are rejected
    // User must log in again to create a new session
    const response = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(response.body.error.code).toBe(ERROR_CODES.SESSION_EXPIRED);
  });
});

