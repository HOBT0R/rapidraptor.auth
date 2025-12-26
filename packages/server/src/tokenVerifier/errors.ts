/**
 * Base error for token verification
 */
export class TokenVerificationError extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

/**
 * Error thrown when token verification fails
 * Includes isExpired flag for expired tokens
 * Compatible with UserTokenVerificationError interface
 */
export class TokenVerificationFailedError extends TokenVerificationError {
  public isExpired?: boolean;

  constructor(message: string, isExpired?: boolean, originalError?: Error) {
    super(message, originalError);
    this.name = 'TokenVerificationFailedError';
    this.isExpired = isExpired;
  }
}

/**
 * Error thrown when token verifier configuration is invalid
 */
export class TokenVerifierConfigurationError extends Error {
  constructor(message: string) {
    super(`Token Verifier Configuration Error: ${message}`);
    this.name = 'TokenVerifierConfigurationError';
  }
}

