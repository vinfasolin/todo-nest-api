// src/users/users.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { Request } from "express";

import { JwtAuthGuard } from "../auth/jwt.guard";
import { UsersService } from "./users.service";

import {
  MeResponseDto,
  UpdateMeDto,
  ChangeEmailDto,
  ChangeEmailResponseDto,
  ChangePasswordDto,
  DeleteMeDto,
  OkResponseDto,
} from "./dto/users.dto";

function requireUid(req: Request): string {
  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) throw new UnauthorizedException("Unauthorized");
  return uid;
}

@ApiTags("Users")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard)
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("me")
  @ApiOperation({ summary: "Retorna o perfil do usuário autenticado" })
  @ApiOkResponse({ description: "Perfil retornado", type: MeResponseDto })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async me(@Req() req: Request): Promise<MeResponseDto> {
    const uid = requireUid(req);
    const dbUser = await this.users.getMe(uid);
    return { ok: true, user: dbUser as any };
  }

  @Patch("me")
  @ApiOperation({ summary: "Atualiza name/picture (Google e Local)" })
  @ApiBody({ type: UpdateMeDto })
  @ApiOkResponse({ description: "Perfil atualizado", type: MeResponseDto })
  @ApiBadRequestResponse({ description: "Payload inválido" })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async updateMe(
    @Req() req: Request,
    @Body() body: UpdateMeDto,
  ): Promise<MeResponseDto> {
    const uid = requireUid(req);
    const updated = await this.users.updateProfile(uid, body);
    return { ok: true, user: updated as any };
  }

  @Patch("me/email")
  @ApiOperation({
    summary: "Altera email (somente conta local) e retorna token novo",
  })
  @ApiBody({ type: ChangeEmailDto })
  @ApiOkResponse({
    description: "Email alterado + token novo",
    type: ChangeEmailResponseDto,
  })
  @ApiBadRequestResponse({
    description: "Email inválido / senha inválida / conflito",
  })
  @ApiForbiddenResponse({ description: "Conta Google não pode alterar email" })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async changeEmail(
    @Req() req: Request,
    @Body() body: ChangeEmailDto,
  ): Promise<ChangeEmailResponseDto> {
    const uid = requireUid(req);
    const { user: updated, token } = await this.users.changeEmail(uid, body);
    return { ok: true, token, user: updated as any };
  }

  @Patch("me/password")
  @ApiOperation({ summary: "Altera senha (somente conta local)" })
  @ApiBody({ type: ChangePasswordDto })
  @ApiOkResponse({ description: "Senha alterada", type: OkResponseDto })
  @ApiBadRequestResponse({
    description: "Senha atual inválida / nova senha fraca",
  })
  @ApiForbiddenResponse({ description: "Conta Google não pode alterar senha" })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async changePassword(
    @Req() req: Request,
    @Body() body: ChangePasswordDto,
  ): Promise<OkResponseDto> {
    const uid = requireUid(req);
    await this.users.changePassword(uid, body);
    return { ok: true };
  }

  @Delete("me")
  @ApiOperation({ summary: "Exclui o usuário autenticado" })
  @ApiBody({ type: DeleteMeDto })
  @ApiOkResponse({ description: "Conta excluída", type: OkResponseDto })
  @ApiBadRequestResponse({ description: "Senha inválida (para conta local)" })
  @ApiForbiddenResponse({
    description: "Regra de conta (ex.: conta local exige password)",
  })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async deleteMe(
    @Req() req: Request,
    @Body() body: DeleteMeDto,
  ): Promise<OkResponseDto> {
    const uid = requireUid(req);
    return await this.users.deleteMe(uid, body);
  }
}