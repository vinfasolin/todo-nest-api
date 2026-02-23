import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

function normEmail(v: any) {
  return String(v || '').trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private signToken(user: { id: string; email: string }) {
    return this.jwt.sign(
      { uid: user.id, sub: user.id, email: user.email },
      {
        secret: process.env.JWT_SECRET || 'dev-secret-change-me',
        expiresIn: '7d',
      },
    );
  }

  async getMe(userId: string) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
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
    if (!dbUser) throw new NotFoundException('User not found');
    return dbUser;
  }

  // ✅ PATCH /me (name/picture) — Google e Local
  async updateProfile(userId: string, body: { name?: any; picture?: any }) {
    const name =
      body.name === undefined ? undefined : String(body.name).trim();
    const picture =
      body.picture === undefined ? undefined : String(body.picture).trim();

    if (name !== undefined && name.length > 120)
      throw new BadRequestException('name too long');
    if (picture !== undefined && picture.length > 2000)
      throw new BadRequestException('picture too long');

    if (name === undefined && picture === undefined) {
      throw new BadRequestException('No fields to update');
    }

    return await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: name === undefined ? undefined : (name ? name : null),
        picture:
          picture === undefined ? undefined : (picture ? picture : null),
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

  // ✅ PATCH /me/email — somente LOCAL, retorna token novo
  async changeEmail(userId: string, body: { newEmail?: any; password?: any }) {
    const newEmail = normEmail(body?.newEmail);
    const password = String(body?.password || '');

    if (!newEmail) throw new BadRequestException('newEmail is required');
    if (!password) throw new BadRequestException('password is required');

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, googleSub: true, passwordHash: true },
    });
    if (!me) throw new NotFoundException('User not found');

    if (me.googleSub) {
      throw new ForbiddenException('Google account cannot change email');
    }
    if (!me.passwordHash) {
      throw new UnauthorizedException('This account has no local password');
    }

    const ok = await bcrypt.compare(password, me.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const existing = await this.prisma.user.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException('Email already in use');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { email: newEmail },
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

    // seu JWT inclui email → devolve token novo
    const token = this.signToken(updated);
    return { user: updated, token };
  }

  // ✅ PATCH /me/password — somente LOCAL
  async changePassword(
    userId: string,
    body: { currentPassword?: any; newPassword?: any },
  ) {
    const currentPassword = String(body?.currentPassword || '');
    const newPassword = String(body?.newPassword || '');

    if (!currentPassword)
      throw new BadRequestException('currentPassword is required');
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('newPassword must be at least 6 chars');
    }

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { googleSub: true, passwordHash: true },
    });
    if (!me) throw new NotFoundException('User not found');

    if (me.googleSub) {
      throw new ForbiddenException('Google account cannot change password');
    }
    if (!me.passwordHash) {
      throw new UnauthorizedException('This account has no local password');
    }

    const ok = await bcrypt.compare(currentPassword, me.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return { ok: true };
  }

  // ✅ DELETE /me — Local exige password, Google não
  async deleteMe(userId: string, body?: { password?: any }) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { googleSub: true, passwordHash: true },
    });
    if (!me) throw new NotFoundException('User not found');

    if (!me.googleSub) {
      const password = String(body?.password || '');
      if (!password) throw new BadRequestException('password is required');
      if (!me.passwordHash) {
        throw new UnauthorizedException('This account has no local password');
      }
      const ok = await bcrypt.compare(password, me.passwordHash);
      if (!ok) throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true };
  }
}