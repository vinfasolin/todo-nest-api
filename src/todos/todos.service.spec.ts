import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TodosService } from './todos.service';

describe('TodosService (unit)', () => {
  let service: TodosService;

  const prismaMock = {
    todo: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TodosService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(TodosService);
  });

  describe('create()', () => {
    it('cria com title válido e description normalizada (trim)', async () => {
      prismaMock.todo.create.mockResolvedValueOnce({
        id: 't1',
        title: 'Teste',
        description: 'desc',
        done: false,
        createdAt: new Date('2026-03-01T10:00:00Z'),
        updatedAt: new Date('2026-03-01T10:00:00Z'),
      });

      const res = await service.create('u1', {
        title: '  Teste ',
        description: '  desc  ',
      });

      expect(prismaMock.todo.create).toHaveBeenCalledTimes(1);
      const arg = prismaMock.todo.create.mock.calls[0][0];

      expect(arg.data.userId).toBe('u1');
      expect(arg.data.title).toBe('Teste');
      expect(arg.data.description).toBe('desc');

      expect(res.id).toBe('t1');
    });

    it('description undefined vira null (normalizeDescription)', async () => {
      prismaMock.todo.create.mockResolvedValueOnce({
        id: 't1',
        title: 'Teste',
        description: null,
        done: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.create('u1', { title: 'Teste' });

      const arg = prismaMock.todo.create.mock.calls[0][0];
      expect(arg.data.description).toBeNull();
    });

    it('falha se title vazio', async () => {
      await expect(
        service.create('u1', { title: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('falha se title > 120', async () => {
      const long = 'a'.repeat(121);
      await expect(service.create('u1', { title: long })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('falha se description > 2000', async () => {
      const long = 'a'.repeat(2001);
      await expect(
        service.create('u1', { title: 'ok', description: long }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listPaged()', () => {
    it('usa where filtrado + retorna totals + nextCursor quando full page', async () => {
      const items = [
        {
          id: 'a',
          title: 'A',
          description: null,
          done: false,
          createdAt: new Date('2026-03-01T10:00:00.000Z'),
          updatedAt: new Date('2026-03-01T10:00:00.000Z'),
        },
        {
          id: 'b',
          title: 'B',
          description: 'x',
          done: true,
          createdAt: new Date('2026-03-01T09:00:00.000Z'),
          updatedAt: new Date('2026-03-01T09:00:00.000Z'),
        },
      ];

      prismaMock.todo.findMany.mockResolvedValueOnce(items);
      prismaMock.todo.count
        .mockResolvedValueOnce(10) // totalAll
        .mockResolvedValueOnce(3); // totalFiltered

      const res = await service.listPaged('u1', {
        take: 2,
        q: 'mer',
        filter: 'all',
      });

      // findMany com where filtrado (OR em title/description)
      expect(prismaMock.todo.findMany).toHaveBeenCalledTimes(1);
      const call = prismaMock.todo.findMany.mock.calls[0][0];

      expect(call.where.userId).toBe('u1');
      expect(call.where.OR).toBeDefined();
      expect(call.take).toBe(2);

      // totals
      expect(res.totalAll).toBe(10);
      expect(res.totalFiltered).toBe(3);

      // nextCursor como "<createdAtISO>|<id>" do último item
      expect(res.nextCursor).toBe('2026-03-01T09:00:00.000Z|b');
    });

    it('nextCursor vira null quando não enche a página', async () => {
      prismaMock.todo.findMany.mockResolvedValueOnce([
        {
          id: 'a',
          title: 'A',
          description: null,
          done: false,
          createdAt: new Date('2026-03-01T10:00:00.000Z'),
          updatedAt: new Date('2026-03-01T10:00:00.000Z'),
        },
      ]);
      prismaMock.todo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      const res = await service.listPaged('u1', { take: 2 });
      expect(res.nextCursor).toBeNull();
    });

    it('aplica cursor composto (userId_createdAt_id) com skip=1', async () => {
      prismaMock.todo.findMany.mockResolvedValueOnce([]);
      prismaMock.todo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await service.listPaged('u1', {
        take: 10,
        cursor: '2026-03-01T10:00:00.000Z|abc',
      });

      const call = prismaMock.todo.findMany.mock.calls[0][0];
      expect(call.cursor).toEqual({
        userId_createdAt_id: {
          userId: 'u1',
          createdAt: new Date('2026-03-01T10:00:00.000Z'),
          id: 'abc',
        },
      });
      expect(call.skip).toBe(1);
    });

    it('compat cursor antigo (apenas id) usa cursor: { id } e skip=1', async () => {
      prismaMock.todo.findMany.mockResolvedValueOnce([]);
      prismaMock.todo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await service.listPaged('u1', { take: 10, cursor: 'onlyIdCursor' });

      const call = prismaMock.todo.findMany.mock.calls[0][0];
      expect(call.cursor).toEqual({ id: 'onlyIdCursor' });
      expect(call.skip).toBe(1);
    });

    it('done tem prioridade sobre filter (done=true força where.done=true)', async () => {
      prismaMock.todo.findMany.mockResolvedValueOnce([]);
      prismaMock.todo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await service.listPaged('u1', {
        take: 10,
        filter: 'open',
        done: true,
      });

      const call = prismaMock.todo.findMany.mock.calls[0][0];
      expect(call.where.done).toBe(true);
    });

    it('take é clampado entre 1..50', async () => {
      prismaMock.todo.findMany.mockResolvedValueOnce([]);
      prismaMock.todo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await service.listPaged('u1', { take: 999 });

      const call = prismaMock.todo.findMany.mock.calls[0][0];
      expect(call.take).toBe(50);
    });
  });

  describe('update()', () => {
    it('falha se todo não existe para o user', async () => {
      prismaMock.todo.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.update('u1', 't1', { title: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('falha se não tiver campos para update', async () => {
      prismaMock.todo.findFirst.mockResolvedValueOnce({ id: 't1' });

      await expect(service.update('u1', 't1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('falha se done não for boolean', async () => {
      prismaMock.todo.findFirst.mockResolvedValueOnce({ id: 't1' });

      await expect(
        service.update('u1', 't1', { done: 'true' as any }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('atualiza title/description/done quando válidos', async () => {
      prismaMock.todo.findFirst.mockResolvedValueOnce({ id: 't1' });
      prismaMock.todo.update.mockResolvedValueOnce({
        id: 't1',
        title: 'Novo',
        description: 'desc',
        done: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.update('u1', 't1', {
        title: '  Novo  ',
        description: '  desc ',
        done: true,
      });

      expect(prismaMock.todo.update).toHaveBeenCalledTimes(1);
      const arg = prismaMock.todo.update.mock.calls[0][0];
      expect(arg.where.id).toBe('t1');
      expect(arg.data.title).toBe('Novo');
      expect(arg.data.description).toBe('desc');
      expect(arg.data.done).toBe(true);

      expect(res.id).toBe('t1');
    });
  });

  describe('remove()', () => {
    it('falha se todo não existe para o user', async () => {
      prismaMock.todo.findFirst.mockResolvedValueOnce(null);

      await expect(service.remove('u1', 't1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deleta quando existe', async () => {
      prismaMock.todo.findFirst.mockResolvedValueOnce({ id: 't1' });
      prismaMock.todo.delete.mockResolvedValueOnce({ id: 't1' });

      const res = await service.remove('u1', 't1');

      expect(prismaMock.todo.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
      expect(res).toEqual({ ok: true });
    });
  });

  describe('removeAll()', () => {
    it('deleteMany por userId e retorna count', async () => {
      prismaMock.todo.deleteMany.mockResolvedValueOnce({ count: 7 });

      const res = await service.removeAll('u1');

      expect(prismaMock.todo.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(res).toEqual({ ok: true, deleted: 7 });
    });
  });

  describe('removeBulk()', () => {
    it('deleteMany respeita busca/filtro', async () => {
      prismaMock.todo.deleteMany.mockResolvedValueOnce({ count: 2 });

      const res = await service.removeBulk('u1', { q: 'abc', filter: 'open' });

      expect(prismaMock.todo.deleteMany).toHaveBeenCalledTimes(1);
      const arg = prismaMock.todo.deleteMany.mock.calls[0][0];

      expect(arg.where.userId).toBe('u1');
      expect(arg.where.done).toBe(false); // open
      expect(arg.where.OR).toBeDefined(); // q aplica OR

      expect(res).toEqual({ ok: true, deleted: 2 });
    });

    it('done tem prioridade sobre filter também no bulk', async () => {
      prismaMock.todo.deleteMany.mockResolvedValueOnce({ count: 1 });

      await service.removeBulk('u1', { filter: 'open', done: true });

      const arg = prismaMock.todo.deleteMany.mock.calls[0][0];
      expect(arg.where.done).toBe(true);
    });
  });

  describe('countAll()/countFiltered()', () => {
    it('countAll chama prisma.count com where { userId }', async () => {
      prismaMock.todo.count.mockResolvedValueOnce(5);

      const res = await service.countAll('u1');

      expect(prismaMock.todo.count).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(res).toBe(5);
    });

    it('countFiltered aplica buildWhere com filtro/busca', async () => {
      prismaMock.todo.count.mockResolvedValueOnce(3);

      const res = await service.countFiltered('u1', { q: 'x', filter: 'done' });

      const arg = prismaMock.todo.count.mock.calls[0][0];
      expect(arg.where.userId).toBe('u1');
      expect(arg.where.done).toBe(true);
      expect(arg.where.OR).toBeDefined();
      expect(res).toBe(3);
    });
  });
});