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

function parseTake(raw: any, fallback = 5) {
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
  return undefined; // se vier lixo, ignora
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

  // GET /todos?take=5&cursor=<id>&q=texto&filter=all|open|done
  // (compat) também aceita done=true|false
  @Get()
  async list(
    @Req() req: any,
    @Query('take') takeRaw?: string,
    @Query('cursor') cursorRaw?: string,
    @Query('q') qRaw?: string,
    @Query('filter') filterRaw?: string,
    @Query('done') doneRaw?: string,
  ) {
    const user = this.getUser(req);

    const take = parseTake(takeRaw, 5);
    const cursor = String(cursorRaw || '').trim() || undefined;

    const q = String(qRaw || '').trim() || undefined;

    // prioridade: se vier done explícito, usa ele
    const doneParsed = parseDone(doneRaw);

    // senão usa filter
    const filter = parseFilter(filterRaw);

    const { items, nextCursor } = await this.service.listPaged(user.uid, {
      take,
      cursor,
      q,
      filter,
      done: doneParsed,
    });

    return { ok: true, items, nextCursor };
  }

  @Post()
  async create(@Req() req: any, @Body() body: CreateTodoBody) {
    const user = this.getUser(req);
    const todo = await this.service.create(user.uid, body);
    return { ok: true, todo };
  }

  // ✅ EXCLUIR TODAS (novo endpoint)
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