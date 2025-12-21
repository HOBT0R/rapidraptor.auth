# Code Review Checklist

## Phase 1: Foundation (Shared Package)
- [x] `packages/shared/src/types.ts` — Core interfaces and types
- [x] `packages/shared/src/constants.ts` — Error codes and default values
- [x] `packages/shared/src/index.ts` — Public API exports

## Phase 2: Server Package (Core Logic)
- [ ] `packages/server/src/firebase/admin.ts` — Firebase Admin initialization
- [ ] `packages/server/src/session/sessionCache.ts` — In-memory cache
- [ ] `packages/server/src/session/firestoreSync.ts` — Firestore sync with throttling
- [ ] `packages/server/src/session/sessionService.ts` — Main session orchestration
- [ ] `packages/server/src/middleware/authMiddleware.ts` — Express middleware
- [ ] `packages/server/src/index.ts` — Server package exports

## Phase 3: Client Package (API Integration)
- [ ] `packages/client/src/core/requestQueue.ts` — Request queuing during refresh
- [ ] `packages/client/src/core/tokenManager.ts` — Token retrieval and refresh
- [ ] `packages/client/src/core/errorHandler.ts` — 401 error handling
- [ ] `packages/client/src/core/apiClient.ts` — Axios client factory
- [ ] `packages/client/src/index.ts` — Client package exports

## Phase 4: Configuration & Documentation
- [ ] Root `package.json` — Workspace setup and dependencies
- [ ] `tsconfig.json` files — TypeScript configuration
- [ ] `README.md` — Usage documentation
- [ ] `vitest.config.ts` — Test configuration

## Phase 5: Tests (Verify Implementation)
- [ ] `packages/shared/**/*.test.ts` — Shared tests (if any)
- [ ] `packages/server/**/*.test.ts` — Server tests
- [ ] `packages/client/**/*.test.ts` — Client tests

## Phase 6: Integration Points
- [ ] `.gitignore` — Ignore patterns
- [ ] `eslint.config.js` — Linting rules

---

### Review Order Notes
This order:
- Starts with shared types/constants
- Builds server components bottom-up (cache → sync → service → middleware)
- Builds client components bottom-up (queue → token → error → API client)
- Reviews tests after understanding the implementation
- Ends with configuration and integration concerns
