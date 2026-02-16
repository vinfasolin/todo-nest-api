import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// ✅ Import do PrismaClient do pacote padrão
// Se o client não foi gerado, o build vai quebrar de qualquer forma.
// Este import é o correto para o seu projeto "funcionando local".
import { PrismaClient } from '@prisma/client';

// ✅ Garante que o client runtime seja carregado (ajuda em alguns cenários de build/TS)
import '@prisma/client/runtime/library';

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
    // aqui $connect existe quando PrismaClient está OK/gerado
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();

    // Encerrar pool pode ser ok. Se tiver restart automático, pode ser melhor não encerrar.
    // Vou manter (como no seu original), mas de forma segura:
    await PrismaService.pool?.end().catch(() => undefined);
    PrismaService.pool = null;
  }
}
