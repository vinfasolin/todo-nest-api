import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import { GoogleIdTokenVerifier } from './google.strategy';

type GoogleLoginBody = { idToken: string };

type RegisterBody = {
  email: string;
  password: string;
  name?: string;
};

type LoginBody = {
  email: string;
  password: string;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleIdTokenVerifier,
    private readonly jwt: JwtService,
  ) {}

  private async sign(user: { id: string; email: string }) {
    return this.jwt.signAsync(
      { uid: user.id, sub: user.id, email: user.email },
      {
        secret: process.env.JWT_SECRET || 'dev-secret-change-me',
        expiresIn: '7d',
      },
    );
  }

  @Post('register')
  async register(@Body() body: RegisterBody) {
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const name = body?.name ? String(body.name).trim() : null;

    if (!email) throw new BadRequestException('Missing email');
    if (!password || password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });

    // se já tem senha cadastrada, não deixa registrar de novo
    if (existing?.passwordHash) {
      throw new BadRequestException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // se já existe por email (ex.: criado via Google), faz "upgrade" adicionando senha
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        name: name ?? undefined,
        passwordHash,
      },
      create: {
        email,
        name,
        passwordHash,
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

    const token = await this.sign(user);
    return { ok: true, token, user };
  }

  @Post('login')
  async login(@Body() body: LoginBody) {
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');

    if (!email) throw new BadRequestException('Missing email');
    if (!password) throw new BadRequestException('Missing password');

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        googleSub: true,
        email: true,
        name: true,
        picture: true,
        passwordHash: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.passwordHash) {
      throw new UnauthorizedException('This account has no local password');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const token = await this.sign(user);
    const { passwordHash, ...safeUser } = user;
    return { ok: true, token, user: safeUser };
  }

  @Post('google')
  async googleLogin(@Body() body: GoogleLoginBody) {
    const idToken = (body?.idToken || '').trim();
    if (!idToken) throw new UnauthorizedException('Missing idToken');

    const payload = await this.google.verify(idToken);

    if (!payload?.sub || !payload?.email) {
      throw new UnauthorizedException('Invalid Google token payload');
    }

    const email = String(payload.email).trim().toLowerCase();
    const googleSub = String(payload.sub).trim();

    // 1) se já existe por googleSub: atualiza e segue
    const bySub = await this.prisma.user.findUnique({
      where: { googleSub },
      select: { id: true },
    });

    let user;
    if (bySub) {
      user = await this.prisma.user.update({
        where: { googleSub },
        data: {
          email,
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
    } else {
      // 2) se não existe por sub, tenta linkar por email
      const byEmail = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true, googleSub: true },
      });

      if (byEmail && !byEmail.googleSub) {
        // linka a conta local com Google
        user = await this.prisma.user.update({
          where: { email },
          data: {
            googleSub,
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
      } else if (byEmail && byEmail.googleSub) {
        throw new UnauthorizedException(
          'Email already linked to another Google account',
        );
      } else {
        // 3) cria novo user google
        user = await this.prisma.user.create({
          data: {
            googleSub,
            email,
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
      }
    }

    const token = await this.sign(user);
    return { ok: true, token, user };
  }
}