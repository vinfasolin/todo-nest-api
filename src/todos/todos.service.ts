import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
//src/todos/todos.service.ts
type CreateTodoBody = {
  title?: string;
  description?: string;
};

type UpdateTodoBody = {
  title?: string;
  description?: string | null;
  done?: boolean;
};

@Injectable()
export class TodosService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeTitle(title: unknown): string {
    const t = String(title ?? '').trim();
    if (!t) throw new BadRequestException('title is required');
    if (t.length > 120)
      throw new BadRequestException('title is too long (max 120)');
    return t;
  }

  private normalizeDescription(desc: unknown): string | null {
    if (desc === undefined) return null;
    if (desc === null) return null;

    const d = String(desc).trim();
    if (!d) return null;
    if (d.length > 2000)
      throw new BadRequestException('description is too long (max 2000)');

    return d;
  }

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
    const todoId = String(id || '').trim();
    if (!todoId) throw new BadRequestException('id is required');

    const exists = await this.prisma.todo.findFirst({
      where: { id: todoId, userId },
      select: { id: true },
    });

    if (!exists) throw new NotFoundException('Todo not found');

    const data: Record<string, any> = {};

    if (body.title !== undefined) data.title = this.normalizeTitle(body.title);
    if (body.description !== undefined)
      data.description = this.normalizeDescription(body.description);

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
    const todoId = String(id || '').trim();
    if (!todoId) throw new BadRequestException('id is required');

    const exists = await this.prisma.todo.findFirst({
      where: { id: todoId, userId },
      select: { id: true },
    });

    if (!exists) throw new NotFoundException('Todo not found');

    await this.prisma.todo.delete({ where: { id: todoId } });
    return { ok: true };
  }
}
