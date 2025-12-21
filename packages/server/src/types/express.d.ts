import type { Request } from 'express';
import type { Logger } from './middleware.js';

declare global {
  namespace Express {
    export interface Request {
      user?: { sub: string; email?: string; name?: string };
      correlationId?: string;
      logger?: Logger;
    }
  }
}

