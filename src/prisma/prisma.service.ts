import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private static pool: Pool | null = null;

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

    super({
      adapter: new PrismaPg(PrismaService.pool),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
  //src/prisma/prisma.service.ts
  async onModuleDestroy() {
    await this.$disconnect();
    await PrismaService.pool?.end().catch(() => undefined);
    PrismaService.pool = null;
  }
}
