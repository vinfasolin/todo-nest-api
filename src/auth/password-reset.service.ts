import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import * as bcrypt from 'bcrypt';
import { randomInt, createHash } from 'crypto';

// src/auth/password-reset.service.ts

function normEmail(v: string) {
  return String(v || '').trim().toLowerCase();
}
function hashCode(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async requestReset(emailRaw: any) {
    const email = normEmail(emailRaw);
    if (!email) throw new BadRequestException('email is required');

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, googleSub: true, passwordHash: true, name: true },
    });

    // sempre responde ok (anti-enumeração)
    if (!user) return { ok: true };

    // conta google não pode resetar senha
    if (user.googleSub) {
      // ainda retorna ok para não revelar
      return { ok: true };
    }

    // se for local mas ainda sem senha (raro), ainda permitimos setar senha via reset
    const code = String(randomInt(100000, 1000000)); // 6 dígitos
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // opcional: limpar resets antigos
    await this.prisma.passwordReset.deleteMany({
      where: { userId: user.id },
    });

    await this.prisma.passwordReset.create({
      data: { userId: user.id, codeHash, expiresAt },
    });

    const subject = 'ToDo Premium — Código para redefinir sua senha';
    const text =
      `Seu código é: ${code}\n\n` +
      `Expira em 15 minutos.\n\n` +
      `Se você não solicitou isso, ignore este email.`;

    await this.mail.send({
      to: user.email,
      subject,
      text,
      fromName: 'ToDo Premium',
    });

    return { ok: true };
  }

  async confirmReset(emailRaw: any, codeRaw: any, newPasswordRaw: any) {
    const email = normEmail(emailRaw);
    const code = String(codeRaw || '').trim();
    const newPassword = String(newPasswordRaw || '');

    if (!email) throw new BadRequestException('email is required');
    if (!code) throw new BadRequestException('code is required');
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('newPassword must be at least 6 chars');
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, googleSub: true },
    });
    if (!user) throw new BadRequestException('Invalid code'); // genérico

    if (user.googleSub) throw new ForbiddenException('Google account cannot reset password');

    const pr = await this.prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        codeHash: hashCode(code),
        usedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!pr) throw new BadRequestException('Invalid code');
    if (pr.expiresAt.getTime() < Date.now()) throw new BadRequestException('Code expired');

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.prisma.passwordReset.update({
        where: { id: pr.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { ok: true };
  }
}