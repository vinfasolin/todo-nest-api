// src/users/users.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { JwtService } from "@nestjs/jwt";

import { PrismaService } from "../prisma/prisma.service";
import {
  ChangeEmailDto,
  ChangePasswordDto,
  DeleteMeDto,
  UpdateMeDto,
} from "./dto/users.dto";

function normEmail(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

/**
 * Normaliza um campo opcional que aceita:
 * - undefined: não mexe
 * - null: limpa
 * - string vazia/whitespace/"null"/"undefined": trata como null (limpa)
 * - string: trim
 */
function normOptString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;

  const s = String(v).trim();
  if (!s) return null;

  const low = s.toLowerCase();
  if (low === "null" || low === "undefined") return null;

  return s;
}

type PublicUserSelect = {
  id: true;
  googleSub: true;
  email: true;
  name: true;
  picture: true;
  createdAt: true;
  updatedAt: true;
};

const PUBLIC_USER_SELECT: PublicUserSelect = {
  id: true,
  googleSub: true,
  email: true,
  name: true,
  picture: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private async signToken(user: { id: string; email: string }) {
    return this.jwt.signAsync(
      { uid: user.id, sub: user.id, email: user.email },
      {
        secret: process.env.JWT_SECRET || "dev-secret-change-me",
        expiresIn: "7d",
      },
    );
  }

  async getMe(userId: string) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLIC_USER_SELECT,
    });

    if (!dbUser) throw new NotFoundException("User not found");
    return dbUser;
  }

  // ✅ PATCH /me (name/picture) — Google e Local
  async updateProfile(userId: string, body: UpdateMeDto) {
    const name = normOptString(body?.name);
    const picture = normOptString(body?.picture);

    // Se o controller/pipe estiver ok, isso raramente dispara,
    // mas mantém a regra resiliente a chamadas internas.
    if (name !== undefined && name !== null) {
      if (name.length > 120) throw new BadRequestException("name too long");
      if (name.length < 1) throw new BadRequestException("name too short");
    }
    if (picture !== undefined && picture !== null) {
      if (picture.length > 2000) throw new BadRequestException("picture too long");
      if (!/^https?:\/\//i.test(picture)) {
        throw new BadRequestException("picture must be a valid URL");
      }
    }

    if (name === undefined && picture === undefined) {
      throw new BadRequestException("No fields to update");
    }

    return await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(picture !== undefined ? { picture } : {}),
      },
      select: PUBLIC_USER_SELECT,
    });
  }

  // ✅ PATCH /me/email — somente LOCAL, retorna token novo
  async changeEmail(userId: string, body: ChangeEmailDto) {
    const newEmail = normEmail(body?.newEmail);
    const password = String(body?.password ?? "").trim();

    if (!newEmail) throw new BadRequestException("newEmail is required");
    if (!password) throw new BadRequestException("password is required");

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, googleSub: true, passwordHash: true, email: true },
    });
    if (!me) throw new NotFoundException("User not found");

    if (me.googleSub) {
      throw new ForbiddenException("Google account cannot change email");
    }
    if (!me.passwordHash) {
      throw new UnauthorizedException("This account has no local password");
    }

    const ok = await bcrypt.compare(password, me.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    // Se for o mesmo email (já normalizado), não faz update/desencadeia conflito
    if (me.email.toLowerCase() === newEmail) {
      const tokenSame = await this.signToken({ id: me.id, email: me.email });
      const userSame = await this.prisma.user.findUnique({
        where: { id: userId },
        select: PUBLIC_USER_SELECT,
      });
      if (!userSame) throw new NotFoundException("User not found");
      return { user: userSame, token: tokenSame };
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException("Email already in use");
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { email: newEmail },
      select: PUBLIC_USER_SELECT,
    });

    const token = await this.signToken(updated);
    return { user: updated, token };
  }

  // ✅ PATCH /me/password — somente LOCAL
  async changePassword(userId: string, body: ChangePasswordDto) {
    const currentPassword = String(body?.currentPassword ?? "").trim();
    const newPassword = String(body?.newPassword ?? "").trim();

    if (!currentPassword) {
      throw new BadRequestException("currentPassword is required");
    }
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException("newPassword must be at least 6 chars");
    }

    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { googleSub: true, passwordHash: true },
    });
    if (!me) throw new NotFoundException("User not found");

    if (me.googleSub) {
      throw new ForbiddenException("Google account cannot change password");
    }
    if (!me.passwordHash) {
      throw new UnauthorizedException("This account has no local password");
    }

    const ok = await bcrypt.compare(currentPassword, me.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    // Evita no-op “trocar” para a mesma senha
    const same = await bcrypt.compare(newPassword, me.passwordHash);
    if (same) {
      throw new BadRequestException("newPassword must be different");
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return { ok: true };
  }

  // ✅ DELETE /me — Local exige password, Google não
  async deleteMe(userId: string, body?: DeleteMeDto) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { googleSub: true, passwordHash: true },
    });
    if (!me) throw new NotFoundException("User not found");

    // Conta local exige password
    if (!me.googleSub) {
      const password = String(body?.password ?? "").trim();
      if (!password) throw new BadRequestException("password is required");
      if (!me.passwordHash) {
        throw new UnauthorizedException("This account has no local password");
      }
      const ok = await bcrypt.compare(password, me.passwordHash);
      if (!ok) throw new UnauthorizedException("Invalid credentials");
    }

    // 🔥 Evita erro de FK se não tiver cascade no Prisma
    await this.prisma.$transaction([
      this.prisma.todo.deleteMany({ where: { userId } }),
      this.prisma.passwordReset.deleteMany({ where: { userId } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);

    return { ok: true };
  }
}