// src/app.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;

  const prismaMock = {
    playingWithNeon: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: PrismaService, useValue: prismaMock }],
    }).compile();

    appController = moduleRef.get<AppController>(AppController);
  });

  it('GET / -> hello() retorna "OK"', () => {
    expect(appController.hello()).toBe('OK');
  });

  it('GET /db -> retorna ok:true e rows (mockados)', async () => {
    prismaMock.playingWithNeon.findMany.mockResolvedValueOnce([{ id: 1 }]);

    const res = await appController.dbTest();

    expect(prismaMock.playingWithNeon.findMany).toHaveBeenCalledWith({
      take: 5,
      orderBy: { id: 'desc' },
    });

    expect(res).toEqual({ ok: true, rows: [{ id: 1 }] });
  });
});