// src/auth/jwt.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export type AuthUser = {
  uid: string;
  sub: string;
  email?: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest() as any;

    const header = String(req.headers?.authorization ?? '').trim();
    const [type, token] = header.split(' ', 2);

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    try {
      const payload: any = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'dev-secret-change-me',
      });

      const sub = String(payload?.sub ?? '').trim();
      const uid = String(payload?.uid ?? sub).trim();
      const email = payload?.email ? String(payload.email).trim() : undefined;

      if (!uid || !sub) {
        throw new UnauthorizedException('Invalid token payload');
      }

      // padroniza para o resto do app
      req.user = { uid, sub, email } satisfies AuthUser;

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}