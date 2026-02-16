import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleIdTokenVerifier } from './google.strategy';

type GoogleLoginBody = {
  idToken: string;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleIdTokenVerifier,
    private readonly jwt: JwtService,
  ) {}

  @Post('google')
  async googleLogin(@Body() body: GoogleLoginBody) {
    const idToken = (body?.idToken || '').trim();
    if (!idToken) throw new UnauthorizedException('Missing idToken');

    const payload = await this.google.verify(idToken);

    if (!payload?.sub || !payload?.email) {
      throw new UnauthorizedException('Invalid Google token payload');
    }

    const user = await this.prisma.user.upsert({
      where: { googleSub: payload.sub },
      update: {
        email: payload.email,
        name: payload.name ?? null,
        picture: payload.picture ?? null,
      },
      create: {
        googleSub: payload.sub,
        email: payload.email,
        name: payload.name ?? null,
        picture: payload.picture ?? null,
      },
      select: {
        id: true,
        googleSub: true,
        email: true,
        name: true,
        picture: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const token = await this.jwt.signAsync(
      {
        uid: user.id,
        sub: user.id,
        email: user.email,
      },
      {
        secret: process.env.JWT_SECRET || 'dev-secret-change-me',
        expiresIn: '7d',
      },
    );

    return { ok: true, token, user };
  }
}
