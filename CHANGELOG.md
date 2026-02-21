# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.0.0](https://github.com/HOBT0R/rapidraptor.auth/compare/v0.3.0...v1.0.0) (2026-02-21)

## [0.3.0](https://github.com/HOBT0R/rapidraptor.auth/compare/v0.2.5...v0.3.0) (2026-02-21)


### Bug Fixes

* **auth:** use sessionId as Firestore doc ID to fix logout/re-login ([c1d78d9](https://github.com/HOBT0R/rapidraptor.auth/commit/c1d78d94e7a8c04351b7fe880b617adb14e092bc))

### [0.2.5](https://github.com/HOBT0R/rapidraptor.auth/compare/v0.2.2...v0.2.5) (2026-01-17)

### [0.2.4](https://github.com/HOBT0R/rapidraptor.auth/compare/v0.2.3...v0.2.4) (2026-01-17)

### [0.2.3](https://github.com/HOBT0R/rapidraptor.auth/compare/v0.2.2...v0.2.3) (2026-01-17)

### [0.2.2](https://github.com/HOBT0R/rapidraptor.auth/compare/v0.2.1...v0.2.2) (2026-01-17)

### [0.2.1](https://github.com/HOBT0R/rapidraptor.auth/compare/v0.1.0...v0.2.1) (2025-12-27)

## [0.1.0] - 2024-12-26

### Added
- Initial release of @rapidraptor/auth library
- Client-side authentication library (@rapidraptor/auth-client)
- Server-side authentication library (@rapidraptor/auth-server)
- Shared types and constants (@rapidraptor/auth-shared)
- Automatic session expiration after 24 hours of inactivity
- Automatic token refresh when session is valid
- Server-side session tracking in Firestore
- In-memory cache for fast session validation
