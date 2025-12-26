# Code Review Checklist for @rapidraptor/auth
## Recommended Review Order
Review in this order to understand dependencies and data flow.
### Phase 1: Foundation Layer (Start Here)
Review shared types and constants first; they define the contract.

- [x] packages/shared/src/constants.ts
  - Verify FIRESTORE_LOGOUTS_COLLECTION_NAME and LOGOUT_TTL_MS are correct
  - Check default values match design (1 hour TTL)
  - Ensure constants are exported
- [x] packages/shared/src/types.ts
  - Review FirestoreLogoutDocument interface structure
  - Verify ApiClientConfig includes logoutEndpoint?: string
  - Check SessionServiceConfig includes logout collection config
  - Ensure all types are properly exported
- [x] packages/shared/src/index.ts
  - Verify FirestoreLogoutDocument is exported
  - Check all new constants are exported

### Phase 2: Server Core Logic (Session Management)
Review session management implementation.

- [x] packages/server/src/session/sessionService.ts
  - Review wasTokenIssuedBeforeLogout() implementation:
    - Handles missing logout records
    - Checks TTL expiration correctly
    - Compares tokenIssuedAt < loggedOutAt correctly
  - Review clearSession() updates:
    - Stores logout timestamp in user_logouts collection
    - Sets expiresAt to 1 hour from now
    - Still clears cache and deletes session
  - Verify constructor accepts new parameters (backward compatible)
  - Check helper methods (parseLogoutDocument, toLogoutDocument)
- [x] packages/server/src/config.ts
  - Verify createSessionService() passes new logout parameters
  - Check defaults are applied correctly

### Phase 3: Server Integration Layer (Middleware)
Review Express middleware that uses session management.

- [x] packages/server/src/middleware/authMiddleware.ts
  - Review JWT iat extraction:
    - Uses jose.decodeJwt() correctly
    - Handles decode errors gracefully
    - Converts seconds to milliseconds correctly
  - Review token revocation check:
    - Called when session doesn't exist
    - Called when session expired
    - Prevents session creation if token revoked
    - Returns appropriate error response
  - Verify error messages match design
  - Check logging is appropriate
- [x] packages/server/src/middleware/logoutHandler.ts (NEW)
  - Verify authentication check (requires req.user)
  - Check idempotent behavior
  - Review error handling
  - Verify logging includes correlation ID
  - Check response format matches design
- [x] packages/server/src/index.ts
  - Verify createLogoutHandler is exported
  - Check FirestoreLogoutDocument type is re-exported

### Phase 4: Client Package (API Integration)
Review client-side implementation.

- [x] packages/client/src/core/apiClient.ts
  - Review ApiClient interface (extends AxiosInstance with logout())
  - Review logout() implementation:
    - Gets token before calling endpoint
    - Handles server errors gracefully (still calls onLogout)
    - Always calls onLogout callback
    - Uses configurable logoutEndpoint (default: /auth/logout)
  - Verify return type is ApiClient not AxiosInstance
- [x] packages/client/src/index.ts
  - Verify ApiClient type is exported

### Phase 5: Dependencies & Configuration
Review package dependencies and configuration.

- [ ] packages/server/package.json
  - Verify jose dependency is added (^5.2.0 or compatible)
  - Check version compatibility
- [ ] packages/shared/package.json
  - Verify no new dependencies needed (types only)
- [ ] packages/client/package.json
  - Verify no new dependencies needed

### Phase 6: Tests (Verify Implementation)
Review tests to ensure coverage.

- [ ] packages/server/src/session/sessionService.test.ts
  - Review clearSession test updates (verifies logout timestamp storage)
  - Review wasTokenIssuedBeforeLogout tests:
    - No logout record
    - Expired logout record
    - Token issued before logout
    - Token issued after logout
  - Check mock setup for logout collection
- [ ] packages/server/src/middleware/logoutHandler.test.ts (NEW)
  - Review successful logout test
  - Review unauthorized logout test
  - Review error handling test
  - Review idempotent behavior test
  - Verify all edge cases covered
- [ ] packages/client/src/core/apiClient.test.ts
  - Review logout method tests:
    - Successful logout flow
    - Server error graceful degradation
    - Custom endpoint configuration
    - No user authenticated case
  - Verify mocks are set up correctly

### Phase 7: Integration & Documentation
Review integration points and documentation.

- [ ] README.md
  - Verify logout handler usage is documented
  - Check apiClient.logout() usage examples
  - Verify all new features are mentioned
- [ ] Type exports consistency
  - Verify all packages export types correctly
  - Check no circular dependencies

## Key Review Focus Areas

### Security
- JWT revocation prevents re-authentication with old tokens
- Logout handler requires authentication
- Token iat extraction is secure

### Error handling
- Graceful degradation when server logout fails
- Proper error codes and messages
- Logging includes correlation IDs

### Backward compatibility
- New constructor parameters have defaults
- Existing code continues to work
- No breaking API changes

### Performance
- Token revocation check only when needed
- Logout records expire after 1 hour (TTL)
- No unnecessary Firestore reads

### Code quality
- Type safety maintained
- Consistent error handling patterns
- Appropriate logging levels

## Quick Review Checklist (If Time-Constrained)
If short on time, prioritize:

- packages/server/src/middleware/authMiddleware.ts - Core security logic
- packages/server/src/session/sessionService.ts - Revocation implementation
- packages/server/src/middleware/logoutHandler.ts - New feature
- packages/client/src/core/apiClient.ts - Client integration
- Test files - Verify coverage

This order ensures you understand the foundation before reviewing integration points, and validates the implementation through tests.