// src/todos/todos.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiBadRequestResponse,
} from "@nestjs/swagger";
import type { Request } from "express";

import { JwtAuthGuard } from "../auth/jwt.guard";
import { TodosService } from "./todos.service";

import {
  CreateTodoDto,
  UpdateTodoDto,
  TodoDto,
  TodoListResponseDto,
  TodoResponseDto,
  DeletedResponseDto,
  OkResponseDto,
  ListTodosQueryDto,
  BulkTodosQueryDto,
  TodoIdParamDto,
} from "./dto/todos.dto";

@ApiTags("Todos")
@ApiBearerAuth("access-token")
@Controller("todos")
@UseGuards(JwtAuthGuard)
export class TodosController {
  constructor(private readonly service: TodosService) {}

  private getUid(req: Request): string {
    const uid = (req as any).user?.uid as string | undefined;
    if (!uid) throw new UnauthorizedException("Missing auth user");
    return uid;
  }

  @Get()
  @ApiOperation({
    summary:
      "Lista To-Dos (paginação cursor-based + busca/filtro server-side + totais)",
  })
  @ApiOkResponse({ description: "Lista paginada", type: TodoListResponseDto })
  @ApiUnprocessableEntityResponse({ description: "Query inválida (DTO)" })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async list(
    @Req() req: Request,
    @Query() query: ListTodosQueryDto,
  ): Promise<TodoListResponseDto> {
    const uid = this.getUid(req);

    const { items, nextCursor, totalAll, totalFiltered } =
      await this.service.listPaged(uid, {
        take: query.take,
        cursor: query.cursor ?? undefined,
        q: query.q ?? undefined,
        filter: (query.filter ?? "all") as any, // ✅ default consistente
        done: query.done,
      });

    return {
      ok: true,
      items: (items || []) as unknown as TodoDto[],
      nextCursor: nextCursor ?? null,
      totalAll,
      totalFiltered,
      total: totalFiltered, // compat
    };
  }

  // ✅ GET /todos/:id
  @Get(":id")
  @ApiOperation({ summary: "Retorna um To-Do por id" })
  @ApiParam({ name: "id", example: "ckxyz..." })
  @ApiOkResponse({ description: "Encontrado", type: TodoResponseDto })
  @ApiNotFoundResponse({ description: "To-Do não encontrado" })
  @ApiUnprocessableEntityResponse({ description: "Parâmetro inválido (DTO)" })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async getOne(
    @Req() req: Request,
    @Param() params: TodoIdParamDto,
  ): Promise<TodoResponseDto> {
    const uid = this.getUid(req);
    const todo = await this.service.getById(uid, params.id);
    return { ok: true, todo: todo as any };
  }

  @Post()
  @ApiOperation({ summary: "Cria um To-Do" })
  @ApiBody({ type: CreateTodoDto })
  @ApiOkResponse({ description: "Criado", type: TodoResponseDto })
  @ApiUnprocessableEntityResponse({
    description: "Payload inválido (DTO) / title obrigatório",
  })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async create(
    @Req() req: Request,
    @Body() body: CreateTodoDto,
  ): Promise<TodoResponseDto> {
    const uid = this.getUid(req);

    const todo = await this.service.create(uid, {
      title: body.title,
      description: body.description ?? undefined,
    });

    return { ok: true, todo: todo as any };
  }

  @Delete("bulk")
  @ApiOperation({ summary: "Exclui em massa por filtro/busca (bulk delete)" })
  @ApiOkResponse({ description: "Quantidade excluída", type: DeletedResponseDto })
  @ApiUnprocessableEntityResponse({ description: "Query inválida (DTO)" })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async removeBulk(
    @Req() req: Request,
    @Query() query: BulkTodosQueryDto,
  ): Promise<DeletedResponseDto> {
    const uid = this.getUid(req);

    return (await this.service.removeBulk(uid, {
      q: query.q ?? undefined,
      filter: (query.filter ?? "all") as any, // ✅ default consistente
      done: query.done,
    })) as any;
  }

  @Delete()
  @ApiOperation({ summary: "Exclui TODOS os To-Dos do usuário (sem filtro)" })
  @ApiOkResponse({ description: "Quantidade excluída", type: DeletedResponseDto })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async removeAll(@Req() req: Request): Promise<DeletedResponseDto> {
    const uid = this.getUid(req);
    return (await this.service.removeAll(uid)) as any;
  }

  @Patch(":id")
  @ApiOperation({ summary: "Atualiza um To-Do" })
  @ApiParam({ name: "id", example: "ckxyz..." })
  @ApiBody({ type: UpdateTodoDto })
  @ApiOkResponse({ description: "Atualizado", type: TodoResponseDto })
  @ApiUnprocessableEntityResponse({ description: "Payload/parâmetro inválido (DTO)" })
  @ApiBadRequestResponse({ description: "Requisição inválida (ex.: update sem campos)" })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async update(
    @Req() req: Request,
    @Param() params: TodoIdParamDto,
    @Body() body: UpdateTodoDto,
  ): Promise<TodoResponseDto> {
    const uid = this.getUid(req);
    const todo = await this.service.update(uid, params.id, body);
    return { ok: true, todo: todo as any };
  }

  @Delete(":id")
  @ApiOperation({ summary: "Exclui um To-Do" })
  @ApiParam({ name: "id", example: "ckxyz..." })
  @ApiOkResponse({ description: "Excluído", type: OkResponseDto })
  @ApiUnprocessableEntityResponse({ description: "Parâmetro inválido (DTO)" })
  @ApiUnauthorizedResponse({ description: "JWT ausente/inválido" })
  async remove(
    @Req() req: Request,
    @Param() params: TodoIdParamDto,
  ): Promise<OkResponseDto> {
    const uid = this.getUid(req);
    await this.service.remove(uid, params.id);
    return { ok: true };
  }
}