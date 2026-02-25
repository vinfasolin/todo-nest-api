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
} from '@nestjs/common';
import { JwtAuthGuard, AuthUser } from '../auth/jwt.guard';
import { TodosService } from './todos.service';

type CreateTodoBody = {
  title?: string;
  description?: string;
};

type UpdateTodoBody = {
  title?: string;
  description?: string | null;
  done?: boolean;
};

type Filter = 'all' | 'open' | 'done';

function parseTake(raw: any, fallback = 10) {
  const n = parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), 50);
}

function parseFilter(raw: any): Filter {
  const v = String(raw ?? 'all').trim().toLowerCase();
  if (v === 'open' || v === 'done') return v;
  return 'all';
}

function parseDone(raw: any): boolean | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return undefined;
}

@Controller('todos')
@UseGuards(JwtAuthGuard)
export class TodosController {
  constructor(private readonly service: TodosService) {}

  private getUser(req: any): AuthUser {
    const u = req.user as AuthUser | undefined;
    if (!u?.uid) throw new UnauthorizedException('Missing auth user');
    return u;
  }

  /**
   * GET /todos?take=10&cursor=<cursor>&q=texto&filter=all|open|done
   * Aliases aceitos:
   *  - status=open|done (alias de filter)
   *  - limit (alias de take)
   *  - search (alias de q)
   * Compat:
   *  - done=true|false tem prioridade sobre filter/status
   *
   * Retorna:
   *  { ok:true, items:Todo[], nextCursor:string|null, totalAll:number, totalFiltered:number }
   *
   * (Opcional) compat: "total" = totalFiltered
   */
  @Get()
  async list(
    @Req() req: any,
    @Query('take') takeRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursorRaw?: string,
    @Query('q') qRaw?: string,
    @Query('search') searchRaw?: string,
    @Query('filter') filterRaw?: string,
    @Query('status') statusRaw?: string,
    @Query('done') doneRaw?: string,
  ): Promise<{
    ok: true;
    items: any[];
    nextCursor: string | null;
    totalAll: number;
    totalFiltered: number;
    total: number; // compat
  }> {
    const user = this.getUser(req);

    const take = parseTake(takeRaw ?? limitRaw, 10);
    const cursor = String(cursorRaw || '').trim() || undefined;
    const q = String(qRaw || searchRaw || '').trim() || undefined;

    const doneParsed = parseDone(doneRaw);
    const effectiveFilterRaw = filterRaw ?? statusRaw;
    const filter = parseFilter(effectiveFilterRaw);

    const { items, nextCursor, totalAll, totalFiltered } =
      await this.service.listPaged(user.uid, {
        take,
        cursor,
        q,
        filter,
        done: doneParsed,
      });

    return {
      ok: true,
      items: items || [],
      nextCursor: nextCursor ?? null,
      totalAll,
      totalFiltered,
      total: totalFiltered, // compat opcional
    };
  }

  @Post()
  async create(@Req() req: any, @Body() body: CreateTodoBody) {
    const user = this.getUser(req);
    const todo = await this.service.create(user.uid, body);
    return { ok: true, todo };
  }

  /**
   * DELETE /todos/bulk?filter=open|done|all&q=texto
   * Aliases aceitos:
   *  - status=open|done (alias de filter)
   *  - search (alias de q)
   * Compat:
   *  - done=true|false tem prioridade
   *
   * Retorno: { ok:true, deleted:number }
   */
  @Delete('bulk')
  async removeBulk(
    @Req() req: any,
    @Query('q') qRaw?: string,
    @Query('search') searchRaw?: string,
    @Query('filter') filterRaw?: string,
    @Query('status') statusRaw?: string,
    @Query('done') doneRaw?: string,
  ) {
    const user = this.getUser(req);

    const q = String(qRaw || searchRaw || '').trim() || undefined;
    const doneParsed = parseDone(doneRaw);

    const effectiveFilterRaw = filterRaw ?? statusRaw;
    const filter = parseFilter(effectiveFilterRaw);

    return this.service.removeBulk(user.uid, {
      q,
      filter,
      done: doneParsed,
    });
  }

  /**
   * DELETE /todos
   * Exclui todas do usuário (sem filtro)
   */
  @Delete()
  async removeAll(@Req() req: any) {
    const user = this.getUser(req);
    return this.service.removeAll(user.uid);
  }

  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateTodoBody,
  ) {
    const user = this.getUser(req);
    const todo = await this.service.update(user.uid, String(id || '').trim(), body);
    return { ok: true, todo };
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const user = this.getUser(req);
    return this.service.remove(user.uid, String(id || '').trim());
  }
}