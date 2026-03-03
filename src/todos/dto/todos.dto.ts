// src/todos/dto/todos.dto.ts
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

type Filter = "all" | "open" | "done";

// ===== Helpers (normalização + parse compat) =====
const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

const normalizeMaybeString = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
};

const toBoolCompat = (v: unknown): boolean | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return undefined;
};

const clampInt = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number.parseInt(String(v ?? fallback), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const normalizeFilter = (raw: unknown): Filter => {
  const v = normalizeMaybeString(raw)?.toLowerCase();
  if (v === "open" || v === "done") return v;
  return "all";
};

// ===== Param DTO =====
export class TodoIdParamDto {
  @ApiProperty({ example: "ckxyz..." })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  id!: string;
}

// ===== Query DTOs =====
// Suporta aliases: take/limit, q/search, filter/status, done (prioridade)
export class ListTodosQueryDto {
  @ApiProperty({
    required: false,
    description: "Itens por página (padrão 10, min 1, max 50)",
    example: 10,
  })
  @Transform(({ obj, value }) => clampInt(value ?? obj?.limit, 10, 1, 50))
  @IsInt()
  @Min(1)
  @Max(50)
  take!: number;

  @ApiProperty({
    required: false,
    description:
      "Cursor composto recomendado: createdAtISO|id (para próxima página). Compat antigo: cursor=<id>.",
    example: "2026-02-24T12:34:56.789Z|ckxyz...",
    type: String,
  })
  @Transform(({ value }) => normalizeMaybeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiProperty({
    required: false,
    description: "Busca em title/description (case-insensitive). Alias: search",
    example: "mercado",
    type: String,
  })
  @Transform(({ obj, value }) => normalizeMaybeString(value ?? obj?.search))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiProperty({
    required: false,
    description: "Filtro: all | open | done. Alias: status",
    example: "open",
    enum: ["all", "open", "done"],
  })
  @Transform(({ obj, value }) => normalizeFilter(value ?? obj?.status))
  @IsOptional()
  @IsIn(["all", "open", "done"])
  filter?: Filter;

  @ApiProperty({
    required: false,
    description:
      "Compat: true/false/1/0/yes/no. Se informado, tem prioridade sobre filter/status.",
    example: "true",
    type: String,
  })
  @Transform(({ value }) => toBoolCompat(value))
  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class BulkTodosQueryDto {
  @ApiProperty({
    required: false,
    description: "Busca (alias: search)",
    example: "teste",
    type: String,
  })
  @Transform(({ obj, value }) => normalizeMaybeString(value ?? obj?.search))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiProperty({
    required: false,
    description: "all | open | done (alias: status)",
    example: "done",
    enum: ["all", "open", "done"],
  })
  @Transform(({ obj, value }) => normalizeFilter(value ?? obj?.status))
  @IsOptional()
  @IsIn(["all", "open", "done"])
  filter?: Filter;

  @ApiProperty({
    required: false,
    description: "Compat: true/false/1/0/yes/no (prioridade)",
    example: "true",
    type: String,
  })
  @Transform(({ value }) => toBoolCompat(value))
  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

// ===== Domain/Response DTOs =====
export class TodoDto {
  @ApiProperty({ example: "ckxyz..." })
  id!: string;

  @ApiProperty({ example: "Comprar leite" })
  title!: string;

  @ApiProperty({
    example: "No mercado",
    required: false,
    nullable: true,
    type: String,
  })
  description?: string | null;

  @ApiProperty({ example: false })
  done!: boolean;

  @ApiProperty({ example: "2026-02-24T12:00:00.000Z" })
  createdAt!: string;

  @ApiProperty({ example: "2026-02-24T12:00:00.000Z" })
  updatedAt!: string;
}

export class CreateTodoDto {
  @ApiProperty({
    example: "Minha tarefa",
    description: "Obrigatório",
    minLength: 1,
    maxLength: 120,
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({
    example: "opcional",
    required: false,
    nullable: true,
    type: String,
    maxLength: 2000,
  })
  @Transform(({ value }) => {
    if (value === null) return null;
    return typeof value === "string" ? value.trim() : value;
  })
  // ✅ aceita undefined ou null; valida string somente se vier string
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class UpdateTodoDto {
  @ApiProperty({ example: "Novo título", required: false })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @ApiProperty({ example: null, required: false, nullable: true, type: String })
  @Transform(({ value }) => {
    if (value === null) return null;
    return typeof value === "string" ? value.trim() : value;
  })
  // ✅ aceita undefined ou null; valida string somente se vier string
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  /**
   * ✅ garante “update sem campos” virar 400 com mensagem clara
   * Dispara erro quando TODOS os campos são undefined.
   * (Se description vier null, isso conta como "campo enviado", então passa.)
   */
  @ApiProperty({ required: false })
  @ValidateIf(
    (o) => o.title === undefined && o.description === undefined && o.done === undefined,
  )
  @Transform(() => "1")
  @IsNotEmpty({
    message: "At least one field (title, description, done) must be provided",
  })
  _atLeastOneField?: string;
}

export class TodoResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ type: TodoDto })
  todo!: TodoDto;
}

export class TodoListResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ type: [TodoDto] })
  items!: TodoDto[];

  @ApiProperty({
    example: "2026-02-24T12:34:56.789Z|ckxyz...",
    required: false,
    nullable: true,
    type: String,
    description: "Cursor da próxima página. Se null, não há mais páginas.",
  })
  nextCursor!: string | null;

  @ApiProperty({ example: 120, description: "Total do usuário sem filtro/busca" })
  totalAll!: number;

  @ApiProperty({ example: 12, description: "Total com filtro/busca aplicados" })
  totalFiltered!: number;

  @ApiProperty({ example: 12, description: "Compat (espelha totalFiltered)" })
  total!: number;
}

export class OkResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}

export class DeletedResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ example: 42, description: "Quantidade excluída" })
  deleted!: number;
}