import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// src/prisma/prisma.service.ts
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private static pool: Pool | null = null;
  private static poolUsers = 0;

  constructor() {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      throw new Error(
        'DATABASE_URL is missing. Set it in .env (local) and in Render env vars.',
      );
    }

    if (!PrismaService.pool) {
      PrismaService.pool = new Pool({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
      });
    }

    PrismaService.poolUsers += 1;

    super({
      adapter: new PrismaPg(PrismaService.pool),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    // desconecta o prisma client
    await this.$disconnect();

    // em dev/hot-reload pode ter múltiplas instâncias. só encerra quando for a última.
    PrismaService.poolUsers -= 1;

    if (PrismaService.poolUsers <= 0) {
      await PrismaService.pool?.end().catch(() => undefined);
      PrismaService.pool = null;
      PrismaService.poolUsers = 0;
    }
  }
}