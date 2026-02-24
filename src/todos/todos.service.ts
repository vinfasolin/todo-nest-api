import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// src/todos/todos.service.ts

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

@Injectable()
export class TodosService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeTitle(title: unknown): string {
    const t = String(title ?? '').trim();
    if (!t) throw new BadRequestException('title is required');
    if (t.length > 120) {
      throw new BadRequestException('title is too long (max 120)');
    }
    return t;
  }

  private normalizeDescription(desc: unknown): string | null {
    if (desc === undefined) return null;
    if (desc === null) return null;

    const d = String(desc).trim();
    if (!d) return null;

    if (d.length > 2000) {
      throw new BadRequestException('description is too long (max 2000)');
    }

    return d;
  }

  private normalizeId(id: unknown): string {
    const v = String(id ?? '').trim();
    if (!v) throw new BadRequestException('id is required');
    return v;
  }

  // ✅ (mantido) lista antiga completa
  async list(userId: string) {
    return this.prisma.todo.findMany({
      where: { userId },
      orderBy: [{ done: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        description: true,
        done: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private buildWhere(
    userId: string,
    opts?: { q?: string; filter?: Filter; done?: boolean },
  ) {
    const where: any = { userId };

    // done explícito tem prioridade
    if (opts?.done === true || opts?.done === false) {
      where.done = opts.done;
    } else {
      const filter = (opts?.filter ?? 'all') as Filter;
      if (filter === 'open') where.done = false;
      if (filter === 'done') where.done = true;
    }

    const q = String(opts?.q ?? '').trim();
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  // ✅ paginação cursor-based + busca/filtro server-side
  // GET /todos?take=5&cursor=<id>&q=abc&filter=open|done|all
  async listPaged(
    userId: string,
    opts: {
      take: number;
      cursor?: string;
      q?: string;
      filter?: Filter;
      done?: boolean;
    },
  ): Promise<{ items: any[]; nextCursor: string | null }> {
    const takeNum = Number(opts?.take);
    const take = Number.isFinite(takeNum)
      ? Math.min(Math.max(takeNum, 1), 50)
      : 5;

    const cursor = String(opts?.cursor || '').trim() || undefined;

    const where = this.buildWhere(userId, {
      q: opts?.q,
      filter: (opts?.filter ?? 'all') as Filter,
      done: opts?.done,
    });

    const items = await this.prisma.todo.findMany({
      where,
      // ✅ ordem estável para paginação (cursor de id)
      // Obs: para filtros + cursor, assumimos id PK e usamos cursor por id.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        title: true,
        description: true,
        done: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const nextCursor =
      items.length === take
        ? String(items[items.length - 1]?.id || '') || null
        : null;

    return { items, nextCursor };
  }

  async create(userId: string, body: CreateTodoBody) {
    const title = this.normalizeTitle(body?.title);
    const description = this.normalizeDescription(body?.description);

    return this.prisma.todo.create({
      data: { title, description, userId },
      select: {
        id: true,
        title: true,
        description: true,
        done: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async update(userId: string, id: string, body: UpdateTodoBody) {
    const todoId = this.normalizeId(id);

    const exists = await this.prisma.todo.findFirst({
      where: { id: todoId, userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Todo not found');

    const data: Record<string, any> = {};

    if (body.title !== undefined) data.title = this.normalizeTitle(body.title);

    if (body.description !== undefined) {
      data.description = this.normalizeDescription(body.description);
    }

    if (body.done !== undefined) {
      if (typeof body.done !== 'boolean') {
        throw new BadRequestException('done must be boolean');
      }
      data.done = body.done;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    return this.prisma.todo.update({
      where: { id: todoId },
      data,
      select: {
        id: true,
        title: true,
        description: true,
        done: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async remove(userId: string, id: string) {
    const todoId = this.normalizeId(id);

    const exists = await this.prisma.todo.findFirst({
      where: { id: todoId, userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Todo not found');

    await this.prisma.todo.delete({ where: { id: todoId } });
    return { ok: true };
  }

  // ✅ NOVO: excluir todas as tarefas do usuário
  async removeAll(userId: string) {
    await this.prisma.todo.deleteMany({ where: { userId } });
    return { ok: true };
  }
}