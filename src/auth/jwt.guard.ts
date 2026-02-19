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
//src/auth/jwt.guard.ts
declare global {
  // permite usar req.user com tipagem
  // eslint-disable-next-line no-var
  var __authUserType: AuthUser | undefined;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest() as any;

    const header = String(req.headers?.authorization || '');
    const [type, token] = header.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'dev-secret-change-me',
      });

      // padroniza para o resto do app
      req.user = {
        uid: payload.uid || payload.sub,
        sub: payload.sub,
        email: payload.email,
      } satisfies AuthUser;

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
