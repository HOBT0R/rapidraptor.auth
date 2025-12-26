import * as jose from 'jose';
import fs from 'fs/promises';
import type { TokenVerifierConfig } from './types.js';
import {
  TokenVerificationFailedError,
  TokenVerifierConfigurationError,
} from './errors.js';
import type { UserTokenVerifier, Logger } from '../types/middleware.js';

/**
 * Default JWT token verifier implementation using jose library
 * Supports JWKS URIs, static public keys, and skip verification mode
 */
export class JoseTokenVerifier implements UserTokenVerifier {
  private jwksClient?: ReturnType<typeof jose.createRemoteJWKSet>;
  private cachedPublicKey?: jose.KeyLike;

  constructor(
    private config: TokenVerifierConfig,
    private logger?: Logger,
  ) {
    // Validate configuration for production mode
    if (!config.skipVerification && !config.publicKey && !config.jwksUri) {
      throw new TokenVerifierConfigurationError(
        'Either publicKey or jwksUri must be provided when skipVerification is false',
      );
    }
  }

  async verify(
    token: string,
    correlationId?: string,
  ): Promise<{ sub: string; email?: string; name?: string }> {
    if (this.config.skipVerification) {
      // Development/test mode - return mock user
      this.logger?.debug?.('JWT verification skipped - using mock user', {
        event: 'jwt_verification_skipped',
        mockUser: this.config.mockUser,
        correlationId,
      });

      return (
        this.config.mockUser || {
          sub: 'dev-user',
          email: 'dev@example.com',
        }
      );
    }

    try {
      // Decode JWT for logging
      const payload = jose.decodeJwt(token);
      const protectedHeader = jose.decodeProtectedHeader(token);

      this.logger?.debug?.('JWT token decoded for verification', {
        event: 'jwt_token_decoded',
        header: {
          alg: protectedHeader.alg,
          typ: protectedHeader.typ,
          kid: protectedHeader.kid, // Key ID - safe to log
        },
        payload: {
          sub: payload.sub,
          email: payload.email,
          exp: payload.exp,
          iat: payload.iat,
        },
        config: {
          skipVerification: this.config.skipVerification,
          publicKey: this.config.publicKey ? '[PROVIDED]' : undefined,
          jwksUri: this.config.jwksUri,
          issuer: this.config.issuer,
          audience: this.config.audience,
        },
        correlationId,
      });
    } catch (e) {
      this.logger?.warn?.(
        'Could not decode JWT token for logging - may be malformed',
        {
          event: 'jwt_decode_failed',
          error: e instanceof Error ? e.message : 'Unknown error',
          correlationId,
        },
      );
    }

    try {
      const key = await this.getVerificationKey(correlationId);
      // TypeScript can't infer that the union type matches jwtVerify's expected type
      // but both KeyLike and createRemoteJWKSet return value are valid
      const { payload } = await jose.jwtVerify(
        token,
        key as Parameters<typeof jose.jwtVerify>[1],
        {
          issuer: this.config.issuer,
          audience: this.config.audience,
        },
      );

      this.logger?.info?.('JWT verification successful', {
        event: 'jwt_verification_success',
        userId: payload.sub,
        email: payload.email,
        correlationId,
      });

      return {
        sub: payload.sub!,
        email: payload.email as string | undefined,
        name: payload.name as string | undefined,
      };
    } catch (error) {
      // Handle expired token specifically
      if (error instanceof jose.errors.JWTExpired) {
        this.logger?.warn?.('JWT token has expired', {
          event: 'jwt_token_expired',
          error: error.message,
          correlationId,
        });

        throw new TokenVerificationFailedError(
          'Token has expired',
          true,
          error,
        );
      }

      this.logger?.error?.('JWT verification failed', {
        event: 'jwt_verification_failed',
        error: {
          name: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        correlationId,
      });

      throw new TokenVerificationFailedError(
        `JWT verification failed: ${(error as Error).message}`,
        false,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private async getVerificationKey(
    correlationId?: string,
  ): Promise<jose.KeyLike | ReturnType<typeof jose.createRemoteJWKSet>> {
    // Prefer static public key if provided
    if (this.config.publicKey) {
      if (!this.cachedPublicKey) {
        this.logger?.debug?.('Loading static public key for JWT verification', {
          event: 'jwt_static_key_loading',
          keyType: this.config.publicKey.startsWith('file://') ? 'file' : 'inline',
          correlationId,
        });

        let pem = this.config.publicKey;
        // If value starts with file:// treat as path
        if (pem.startsWith('file://')) {
          const path = pem.replace('file://', '');
          pem = await fs.readFile(path, 'utf-8');
        }
        this.cachedPublicKey = await jose.importSPKI(pem, 'RS256');

        this.logger?.debug?.('Static public key loaded successfully', {
          event: 'jwt_static_key_loaded',
          correlationId,
        });
      }
      return this.cachedPublicKey;
    }

    // Otherwise fallback to remote JWKS
    if (!this.jwksClient) {
      if (!this.config.jwksUri) {
        throw new TokenVerifierConfigurationError('JWKS URI not configured');
      }

      this.logger?.debug?.('Creating remote JWKS client', {
        event: 'jwt_jwks_client_created',
        jwksUri: this.config.jwksUri,
        correlationId,
      });

      this.jwksClient = jose.createRemoteJWKSet(new URL(this.config.jwksUri));
    }
    return this.jwksClient;
  }

  /**
   * Clear cached keys (useful for testing or key rotation)
   */
  clearCache(): void {
    this.jwksClient = undefined;
    this.cachedPublicKey = undefined;

    this.logger?.debug?.('JWT verification cache cleared', {
      event: 'jwt_cache_cleared',
    });
  }
}

