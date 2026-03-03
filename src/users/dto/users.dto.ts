// src/users/dto/users.dto.ts
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

// Helpers de normalização
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

// Normaliza string opcional que pode ser null
// - undefined: não mexe
// - null: limpa
// - string: trim
const optTrimOrNull = ({ value }: { value: unknown }) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value.trim() : value;
};

// ===== Responses =====

export class PublicUserDto {
  @ApiProperty({ example: "ckxyz...", description: "ID do usuário." })
  id!: string;

  @ApiProperty({
    example: "teste@teste.com",
    description: "Email do usuário (sempre lower-case).",
  })
  email!: string;

  @ApiProperty({
    example: "GoogleSubOpcional",
    required: false,
    nullable: true,
    type: String,
    description: "Google sub (quando a conta está vinculada ao Google).",
  })
  googleSub?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    example: "Cláudio",
    description: "Nome exibido (pode ser null).",
  })
  name?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    example: "https://armazenamentoarquivos.com.br/api-images/uploads/avatar.png",
    description: "URL pública da foto do perfil (pode ser null).",
  })
  picture?: string | null;

  @ApiProperty({
    example: "2026-02-24T12:00:00.000Z",
    format: "date-time",
    description: "Data de criação (ISO).",
  })
  createdAt!: string;

  @ApiProperty({
    example: "2026-02-24T12:00:00.000Z",
    format: "date-time",
    description: "Data de atualização (ISO).",
  })
  updatedAt!: string;
}

export class OkResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}

export class MeResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ type: PublicUserDto })
  user!: PublicUserDto;
}

export class ChangeEmailResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({
    example: "JWT_DA_API_AQUI",
    description: "Novo token com o email atualizado no payload.",
  })
  token!: string;

  @ApiProperty({ type: PublicUserDto })
  user!: PublicUserDto;
}

// ===== Requests =====

export class UpdateMeDto {
  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    example: "Cláudio",
    description:
      "Nome do usuário (pode ser null para limpar). String vazia não é aceita.",
  })
  @Transform(optTrimOrNull)
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    example: "https://armazenamentoarquivos.com.br/api-images/uploads/avatar.png",
    description:
      "URL da foto (pode ser null para limpar). String vazia não é aceita.",
  })
  @Transform(optTrimOrNull)
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(2000)
  @IsUrl(
    { require_protocol: true }, // ✅ suficiente pro seu caso
    { message: "picture must be a valid URL" },
  )
  picture?: string | null;
}

export class ChangeEmailDto {
  @ApiProperty({
    example: "novo@exemplo.com",
    description: "Novo email (será normalizado para lower-case).",
  })
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  newEmail!: string;

  @ApiProperty({
    example: "123456",
    description: "Senha atual (obrigatória para conta local).",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: "123456", description: "Senha atual." })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @ApiProperty({
    example: "novaSenha123",
    minLength: 6,
    description: "Nova senha (mínimo 6). String vazia não é aceita.",
  })
  @Transform(trim)
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  newPassword!: string;
}

export class DeleteMeDto {
  @ApiProperty({
    required: false,
    type: String,
    example: "123456",
    description:
      "Obrigatório para conta local. Para conta Google, pode omitir. String vazia não é aceita.",
  })
  @Transform(trim)
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password?: string;
}