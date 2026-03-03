// src/auth/dto/auth.dto.ts
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  MinLength,
  Matches,
  ValidateIf,
} from "class-validator";

// Helpers de normalização (mantém consistência e reduz bugs)
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class AuthRegisterDto {
  @ApiProperty({
    example: "teste@teste.com",
    description: "Email do usuário (normalizado em lower-case no backend).",
  })
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: "123456",
    minLength: 6,
    description: "Senha (mínimo 6 caracteres).",
  })
  @Transform(trim)
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  password!: string;

  @ApiProperty({
    example: "Cláudio",
    required: false,
    nullable: true,
    type: String,
    description: "Nome opcional (pode ser null para não definir).",
  })
  @Transform(({ value }) => {
    // permite null explicitamente
    if (value === null) return null;
    return typeof value === "string" ? value.trim() : value;
  })
  // ✅ valida apenas se vier como string (aceita undefined ou null)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(120)
  name?: string | null;
}

export class AuthLoginDto {
  @ApiProperty({ example: "teste@teste.com" })
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: "123456" })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class AuthGoogleDto {
  @ApiProperty({
    example: "GOOGLE_ID_TOKEN_AQUI",
    description: "Google ID Token retornado pelo Google Sign-In.",
  })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(10000) // evita payloads absurdos
  idToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({
    example: "teste@teste.com",
    description: "Email para solicitar código de redefinição.",
  })
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: "teste@teste.com" })
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: "123456",
    description: "Código recebido por e-mail (expira em ~15 minutos).",
  })
  @Transform(trim)
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code!: string;

  @ApiProperty({ example: "novaSenha123", minLength: 6 })
  @Transform(trim)
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  newPassword!: string;
}

// ====== Responses (para Swagger ficar forte) ======
// Observação: validação de DTO de Response não é necessária em runtime
// (Nest não valida o que você "retorna"), mas manter tipado ajuda Swagger.

export class PublicUserDto {
  @ApiProperty({ example: "ckxyz..." })
  id!: string;

  @ApiProperty({ example: "teste@teste.com" })
  email!: string;

  @ApiProperty({
    example: "GoogleSubOpcional",
    required: false,
    nullable: true,
    type: String,
  })
  googleSub?: string | null;

  @ApiProperty({
    example: "Cláudio",
    required: false,
    nullable: true,
    type: String,
  })
  name?: string | null;

  @ApiProperty({
    example: "https://...",
    required: false,
    nullable: true,
    type: String,
  })
  picture?: string | null;

  @ApiProperty({
    example: "2026-02-24T12:00:00.000Z",
    description: "ISO date-time",
  })
  createdAt!: string;

  @ApiProperty({
    example: "2026-02-24T12:00:00.000Z",
    description: "ISO date-time",
  })
  updatedAt!: string;
}

export class AuthResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({
    example: "JWT_DA_API_AQUI",
    description: "JWT próprio da API (Bearer).",
  })
  token!: string;

  @ApiProperty({ type: PublicUserDto })
  user!: PublicUserDto;
}

export class OkResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}