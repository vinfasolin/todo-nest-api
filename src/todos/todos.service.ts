// src/todos/todos.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Todo as PrismaTodo } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";


type Filter = "all" | "open" | "done";

type ListOpts = {
  take: number; // pode vir inválido em unit test; clamp aqui também
  cursor?: string;
  q?: string;
  filter?: Filter;
  done?: boolean;
};

type BulkOpts = {
  q?: string;
  filter?: Filter;
  done?: boolean;
};

type CreateBody = {
  // unit tests chamam com { title: long } e sem description
  title?: string;
  description?: string | null;
};

type UpdateBody = {
  title?: string;
  description?: string | null;
  done?: boolean;
};

@Injectable()
export class TodosService {
  constructor(private readonly prisma: PrismaService) {}

  private clampTake(raw: unknown, fallback = 10) {
    const n = Number.parseInt(String(raw ?? fallback), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, 1), 50);
  }

  private normalizeId(id: unknown): string {
    const v = String(id ?? "").trim();
    if (!v) throw new BadRequestException("id is required");
    return v;
  }

  private normalizeTitle(title: unknown): string {
    const t = String(title ?? "").trim();
    if (!t) throw new BadRequestException("title is required");
    if (t.length > 120) {
      throw new BadRequestException("title is too long (max 120)");
    }
    return t;
  }

  private normalizeDescription(desc: unknown): string | null {
    if (desc === undefined) return null;
    if (desc === null) return null;

    const d = String(desc).trim();
    if (!d) return null;

    if (d.length > 2000) {
      throw new BadRequestException("description is too long (max 2000)");
    }

    return d;
  }

  // cursor composto: "<createdAtISO>|<id>"
  private encodeCursor(createdAt: Date | string, id: string) {
    const iso = typeof createdAt === "string" ? createdAt : createdAt.toISOString();
    return `${iso}|${id}`;
  }

  private decodeCursor(raw?: string): { createdAt?: Date; id?: string } {
    const s = String(raw ?? "").trim();
    if (!s) return {};

    const sep = s.indexOf("|");
    if (sep >= 0) {
      const iso = s.slice(0, sep);
      const id = s.slice(sep + 1);
      const dt = new Date(String(iso));
      const tid = String(id ?? "").trim();
      if (!tid || Number.isNaN(dt.getTime())) return {};
      return { createdAt: dt, id: tid };
    }

    // compat antigo: só id
    return { id: s };
  }

  // lista antiga
  async list(userId: string) {
    return this.prisma.todo.findMany({
      where: { userId },
      orderBy: [{ done: "asc" }, { createdAt: "desc" }],
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
  ): Prisma.TodoWhereInput {
    const where: Prisma.TodoWhereInput = { userId };

    if (opts?.done === true || opts?.done === false) {
      where.done = opts.done;
    } else {
      const filter = (opts?.filter ?? "all") as Filter;
      if (filter === "open") where.done = false;
      if (filter === "done") where.done = true;
    }

    const q = String(opts?.q ?? "").trim();
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    return where;
  }

  // ✅ reintroduzidos (unit tests dependem)
  async countAll(userId: string): Promise<number> {
    return this.prisma.todo.count({ where: { userId } });
  }

  async countFiltered(
    userId: string,
    opts?: { q?: string; filter?: Filter; done?: boolean },
  ): Promise<number> {
    const where = this.buildWhere(userId, {
      q: opts?.q,
      filter: (opts?.filter ?? "all") as Filter,
      done: opts?.done,
    });
    return this.prisma.todo.count({ where });
  }



  async getById(uid: string, id: string) {
    const todo = await this.prisma.todo.findFirst({
      where: { id, userId: uid },
    });

    if (!todo) {
      throw new NotFoundException("Todo not found");
    }

    return todo;
  }

  async listPaged(
    userId: string,
    opts: ListOpts,
  ): Promise<{
    items: Array<
      Pick<
        PrismaTodo,
        "id" | "title" | "description" | "done" | "createdAt" | "updatedAt"
      >
    >;
    nextCursor: string | null;
    totalAll: number;
    totalFiltered: number;
  }> {
    // ✅ clamp aqui também (unit test passa 999)
    const take = this.clampTake(opts?.take, 10);

    const cursorRaw = String(opts?.cursor || "").trim() || undefined;

    const whereFiltered = this.buildWhere(userId, {
      q: opts?.q,
      filter: (opts?.filter ?? "all") as Filter,
      done: opts?.done,
    });

    const decoded = this.decodeCursor(cursorRaw);
    const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];

    const useComposite =
      decoded.createdAt instanceof Date &&
      !Number.isNaN(decoded.createdAt.getTime()) &&
      !!decoded.id;

    const [items, totalAll, totalFiltered] = await Promise.all([
      this.prisma.todo.findMany({
        where: whereFiltered,
        orderBy,
        take,
        ...(useComposite
          ? {
              cursor: {
                userId_createdAt_id: {
                  userId,
                  createdAt: decoded.createdAt!,
                  id: decoded.id!,
                },
              },
              skip: 1,
            }
          : decoded.id
          ? {
              cursor: { id: decoded.id },
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
      }),
      this.prisma.todo.count({ where: { userId } }),
      this.prisma.todo.count({ where: whereFiltered }),
    ]);

    const nextCursor =
      items.length === take
        ? this.encodeCursor(
            items[items.length - 1]!.createdAt,
            String(items[items.length - 1]!.id),
          )
        : null;

    return { items, nextCursor, totalAll, totalFiltered };
  }

  async create(userId: string, body: CreateBody) {
    // ✅ validações para unit tests
    const title = this.normalizeTitle(body?.title);

    const description =
      body?.description === undefined ? null : this.normalizeDescription(body.description);

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

  async update(userId: string, id: string, body: UpdateBody) {
    const todoId = this.normalizeId(id);

    const exists = await this.prisma.todo.findFirst({
      where: { id: todoId, userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Todo not found");

    const data: Prisma.TodoUpdateInput = {};

    if (body.title !== undefined) data.title = this.normalizeTitle(body.title);

    if (body.description !== undefined) {
      data.description = this.normalizeDescription(body.description);
    }

    if (body.done !== undefined) {
      if (typeof body.done !== "boolean") {
        throw new BadRequestException("done must be boolean");
      }
      data.done = body.done;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException("No fields to update");
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
    if (!exists) throw new NotFoundException("Todo not found");

    await this.prisma.todo.delete({ where: { id: todoId } });
    return { ok: true };
  }

  async removeAll(userId: string) {
    const r = await this.prisma.todo.deleteMany({ where: { userId } });
    return { ok: true, deleted: r.count };
  }

  async removeBulk(userId: string, opts?: BulkOpts) {
    const where = this.buildWhere(userId, {
      q: opts?.q,
      filter: (opts?.filter ?? "all") as Filter,
      done: opts?.done,
    });

    const r = await this.prisma.todo.deleteMany({ where });
    return { ok: true, deleted: r.count };
  }
}