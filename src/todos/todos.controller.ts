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

@Controller('todos')
@UseGuards(JwtAuthGuard)
export class TodosController {
  constructor(private readonly service: TodosService) {}

  private getUser(req: any): AuthUser {
    const u = req.user as AuthUser | undefined;
    if (!u?.uid) throw new UnauthorizedException('Missing auth user');
    return u;
  }

  @Get()
  async list(
    @Req() req: any,
    @Query('take') takeRaw?: string,
    @Query('cursor') cursorRaw?: string,
  ) {
    const user = this.getUser(req);

    const takeNum = parseInt(String(takeRaw || '5'), 10);
    const take = Number.isFinite(takeNum) ? Math.min(Math.max(takeNum, 1), 50) : 5;

    const cursor = String(cursorRaw || '').trim() || undefined;

    // ✅ novo método no service (vamos criar no próximo passo)
    const { items, nextCursor } = await this.service.listPaged(user.uid, { take, cursor });

    return { ok: true, items, nextCursor };
  }

  @Post()
  async create(@Req() req: any, @Body() body: CreateTodoBody) {
    const user = this.getUser(req);
    const todo = await this.service.create(user.uid, body);
    return { ok: true, todo };
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