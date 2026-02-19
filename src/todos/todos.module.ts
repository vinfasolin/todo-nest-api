import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  Module,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard, AuthUser } from '../auth/jwt.guard';
//src/todos/todos.module.ts
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
class TodosService {
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
    const todoId = this.normalizeId(id);

    const exists = await this.prisma.todo.findFirst({
      where: { id: todoId, userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Todo not found');

    const data: Record<string, unknown> = {};

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
}

@Controller('todos')
@UseGuards(JwtAuthGuard)
class TodosController {
  constructor(private readonly service: TodosService) {}

  private getUser(req: any): AuthUser {
    const u = req.user as AuthUser | undefined;
    if (!u?.uid) throw new UnauthorizedException('Missing auth user');
    return u;
  }

  @Get()
  async list(@Req() req: any) {
    const user = this.getUser(req);
    const items = await this.service.list(user.uid);
    return { ok: true, items };
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
    const todo = await this.service.update(user.uid, id, body);
    return { ok: true, todo };
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const user = this.getUser(req);
    return this.service.remove(user.uid, id);
  }
}

@Module({
  imports: [
    // ✅ traz JwtModule/JwtService via AuthModule exports
    AuthModule,
  ],
  controllers: [TodosController],
  providers: [
    TodosService,
    // ✅ JwtAuthGuard precisa de JwtService (vem do AuthModule)
    JwtAuthGuard,
  ],
})
export class TodosModule {}
