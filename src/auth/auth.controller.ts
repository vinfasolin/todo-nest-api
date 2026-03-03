// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  BadRequestException,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import * as bcrypt from "bcrypt";
import { Throttle } from "@nestjs/throttler";

import { PrismaService } from "../prisma/prisma.service";
import { GoogleIdTokenVerifier } from "./google.strategy";
import { PasswordResetService } from "./password-reset.service";

import {
  AuthGoogleDto,
  AuthLoginDto,
  AuthRegisterDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  AuthResponseDto,
  OkResponseDto,
} from "./dto/auth.dto";

// ✅ usa o guard compatível do seu projeto (mesma lógica do global)
import { ThrottlerSkipGuard } from "../common/throttle/throttler-skip.guard";

type PublicUser = {
  id: string;
  googleSub: string | null;
  email: string;
  name: string | null;
  picture: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@ApiTags("Auth")
@UseGuards(ThrottlerSkipGuard) // ✅ throttling só aqui (sem quebrar tokens/DI)
@Controller("auth")
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleIdTokenVerifier,
    private readonly jwt: JwtService,
    private readonly reset: PasswordResetService,
  ) {}

  private async sign(user: { id: string; email: string }) {
    return this.jwt.signAsync(
      { uid: user.id, sub: user.id, email: user.email },
      {
        secret: process.env.JWT_SECRET || "dev-secret-change-me",
        expiresIn: "7d",
      },
    );
  }

  // ✅ 10 req / 60s
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Post("register")
  @ApiOperation({
    summary: "Registro local (email/senha) → JWT da API",
    description:
      "Cria uma conta local (ou converte uma conta existente sem senha local) e retorna um JWT (Bearer) válido por 7 dias.",
  })
  @ApiBody({
    type: AuthRegisterDto,
    examples: {
      basic: {
        summary: "Registro básico",
        value: { email: "teste@teste.com", password: "123456", name: "Cláudio" },
      },
      withoutName: {
        summary: "Sem nome (name omitido)",
        value: { email: "teste2@teste.com", password: "123456" },
      },
      nullName: {
        summary: "Nome explícito como null",
        value: { email: "teste3@teste.com", password: "123456", name: null },
      },
    },
  })
  @ApiCreatedResponse({
    description: "Usuário registrado/autenticado",
    type: AuthResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: "Erro de validação (DTO)" })
  @ApiBadRequestResponse({
    description:
      "Regras manuais/negócio: email já cadastrado com senha local, senha fraca, missing fields (sem pipe)",
  })
  @ApiTooManyRequestsResponse({ description: "Rate limit atingido (429)" })
  async register(@Body() body: AuthRegisterDto) {
    // ⚠️ Unit tests chamam o controller direto (sem ValidationPipe),
    // então precisamos manter validações mínimas aqui também.
    const rawEmail = String((body as any)?.email ?? "");
    const rawPassword = String((body as any)?.password ?? "");

    const email = rawEmail.trim().toLowerCase();
    if (!email) throw new BadRequestException("Missing email");

    if (!rawPassword) throw new BadRequestException("Missing password");
    if (rawPassword.length < 6) {
      throw new BadRequestException("Password must be at least 6 characters");
    }

    const name =
      body?.name === null
        ? null
        : body?.name
          ? String(body.name).trim()
          : null;

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });

    if (existing?.passwordHash) {
      throw new BadRequestException("Email already registered");
    }

    const passwordHash = await bcrypt.hash(rawPassword, 10);

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

  // ✅ 10 req / 60s
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Post("login")
  @ApiOperation({
    summary: "Login local (email/senha) → JWT da API",
    description:
      "Autentica via email/senha e retorna um JWT (Bearer). Contas Google sem senha local não podem fazer login por aqui.",
  })
  @ApiBody({
    type: AuthLoginDto,
    examples: {
      basic: {
        summary: "Login básico",
        value: { email: "teste@teste.com", password: "123456" },
      },
    },
  })
  @ApiCreatedResponse({ description: "Autenticado", type: AuthResponseDto })
  @ApiUnprocessableEntityResponse({ description: "Erro de validação (DTO)" })
  @ApiBadRequestResponse({ description: "Missing email/password (sem pipe)" })
  @ApiUnauthorizedResponse({
    description: "Credenciais inválidas / conta sem senha local",
  })
  @ApiTooManyRequestsResponse({ description: "Rate limit atingido (429)" })
  async login(@Body() body: AuthLoginDto) {
    // ⚠️ Unit tests chamam direto, então valida aqui também.
    const rawEmail = String((body as any)?.email ?? "");
    const rawPassword = String((body as any)?.password ?? "");

    const email = rawEmail.trim().toLowerCase();
    if (!email) throw new BadRequestException("Missing email");

    const password = rawPassword;
    if (!password) throw new BadRequestException("Missing password");

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

    if (!user) throw new UnauthorizedException("Invalid credentials");

    if (!user.passwordHash) {
      throw new UnauthorizedException("This account has no local password");
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    const token = await this.sign(user);
    const { passwordHash, ...safeUser } = user;
    return { ok: true, token, user: safeUser };
  }

  // ✅ 30 req / 60s
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @Post("google")
  @ApiOperation({
    summary: "Login Google (idToken) → JWT da API",
    description:
      "Valida o Google ID Token, cria/vincula o usuário por email (quando aplicável) e retorna o JWT da API (Bearer).",
  })
  @ApiBody({
    type: AuthGoogleDto,
    examples: {
      basic: {
        summary: "Google Sign-In",
        value: { idToken: "GOOGLE_ID_TOKEN_AQUI" },
      },
    },
  })
  @ApiCreatedResponse({
    description: "Autenticado via Google",
    type: AuthResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: "Erro de validação (DTO)" })
  @ApiBadRequestResponse({ description: "Requisição inválida (sem pipe)" })
  @ApiUnauthorizedResponse({
    description:
      "Missing/invalid Google token / payload inválido / conflito de vínculo por email",
  })
  @ApiTooManyRequestsResponse({ description: "Rate limit atingido (429)" })
  async googleLogin(@Body() body: AuthGoogleDto) {
    const idToken = String((body as any)?.idToken ?? "").trim();
    if (!idToken) throw new UnauthorizedException("Missing idToken");

    const payload = await this.google.verify(idToken);

    if (!payload?.sub || !payload?.email) {
      throw new UnauthorizedException("Invalid Google token payload");
    }

    const email = String(payload.email).trim().toLowerCase();
    const googleSub = String(payload.sub).trim();

    const bySub = await this.prisma.user.findUnique({
      where: { googleSub },
      select: { id: true },
    });

    let user: PublicUser;

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
      const byEmail = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true, googleSub: true },
      });

      if (byEmail && !byEmail.googleSub) {
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
          "Email already linked to another Google account",
        );
      } else {
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

  // ✅ 5 req / 60s
  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Post("forgot-password")
  @ApiOperation({
    summary: "Solicita código de reset de senha (somente conta local)",
    description:
      "Sempre retorna ok:true (anti-enumeração). Se existir conta local, envia o código por e-mail via MailService.",
  })
  @ApiBody({
    type: ForgotPasswordDto,
    examples: {
      basic: {
        summary: "Solicitar reset",
        value: { email: "teste@teste.com" },
      },
    },
  })
  @ApiCreatedResponse({
    description: "Sempre retorna ok:true (anti-enumeração)",
    type: OkResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: "Erro de validação (DTO)" })
  @ApiTooManyRequestsResponse({ description: "Rate limit atingido (429)" })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    const email = String((body as any)?.email ?? "").trim().toLowerCase();
    await this.reset.requestReset(email);
    return { ok: true };
  }

  // ✅ 5 req / 60s
  @Throttle({ default: { limit: 5, ttl: 60 } })
  @Post("reset-password")
  @ApiOperation({
    summary: "Confirma código e define nova senha (somente conta local)",
    description:
      "Valida código (6 dígitos), expiração (~15min) e define nova senha. Contas Google não podem resetar senha.",
  })
  @ApiBody({
    type: ResetPasswordDto,
    examples: {
      basic: {
        summary: "Confirmar reset",
        value: { email: "teste@teste.com", code: "123456", newPassword: "654321" },
      },
    },
  })
  @ApiCreatedResponse({ description: "Senha redefinida", type: OkResponseDto })
  @ApiUnprocessableEntityResponse({ description: "Erro de validação (DTO)" })
  @ApiBadRequestResponse({
    description: "Código inválido/expirado / senha fraca / dados inválidos",
  })
  @ApiUnauthorizedResponse({
    description: "Conta Google não pode resetar senha",
  })
  @ApiTooManyRequestsResponse({ description: "Rate limit atingido (429)" })
  async resetPassword(@Body() body: ResetPasswordDto) {
    const email = String((body as any)?.email ?? "").trim().toLowerCase();
    const code = String((body as any)?.code ?? "").trim();
    const newPassword = String((body as any)?.newPassword ?? "");

    await this.reset.confirmReset(email, code, newPassword);
    return { ok: true };
  }
}