// src/types/express.d.ts
import type { AuthUser } from '../auth/jwt.guard';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};