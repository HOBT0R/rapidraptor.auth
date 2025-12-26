/**
 * Configuration for JWT token verification
 */
export interface TokenVerifierConfig {
  /**
   * Skip verification (development/test mode only)
   * When true, returns a mock user without verifying the token
   */
  skipVerification?: boolean;

  /**
   * Static public key in PEM format for JWT verification
   * Can be provided inline or as a file path (prefix with 'file://')
   * Example: 'file:///path/to/public-key.pem' or '-----BEGIN PUBLIC KEY-----\n...'
   */
  publicKey?: string;

  /**
   * JWKS (JSON Web Key Set) URI for remote key lookup
   * Used for OAuth providers like Firebase, Auth0, etc.
   * Example: 'https://www.googleapis.com/service_accounts/v1/jwk/...'
   */
  jwksUri?: string;

  /**
   * Expected JWT issuer (iss claim)
   * If provided, tokens must have matching issuer
   */
  issuer?: string;

  /**
   * Expected JWT audience (aud claim)
   * If provided, tokens must have matching audience
   */
  audience?: string;

  /**
   * Mock user to return when skipVerification is true
   */
  mockUser?: {
    sub: string;
    email?: string;
    name?: string;
  };
}

