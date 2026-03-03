// src/prisma/prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

function readBoolEnv(name: string, fallback: boolean) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return fallback;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private static pool: Pool | null = null;
  private static poolUsers = 0;

  constructor() {
    const url = String(process.env.DATABASE_URL ?? "").trim();
    if (!url) {
      throw new Error(
        "DATABASE_URL is missing. Set it in .env (local) and in Render env vars.",
      );
    }

    /**
     * SSL strategy (mais robusta):
     * - Se PG_SSL estiver definido, ele manda.
     * - Senão:
     *    - production => SSL on
     *    - dev/test   => SSL off
     *
     * rejectUnauthorized configurável:
     * - PG_SSL_REJECT_UNAUTHORIZED=true  -> verifica certificado (mais seguro)
     * - PG_SSL_REJECT_UNAUTHORIZED=false -> aceita cert self/chain (mais compat)
     */
    const isProd = String(process.env.NODE_ENV ?? "").toLowerCase() === "production";
    const useSsl = readBoolEnv("PG_SSL", isProd);
    const rejectUnauthorized = readBoolEnv("PG_SSL_REJECT_UNAUTHORIZED", false);

    if (!PrismaService.pool) {
      PrismaService.pool = new Pool({
        connectionString: url,
        ...(useSsl
          ? {
              ssl: { rejectUnauthorized },
            }
          : {}),
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
    await this.$disconnect();

    PrismaService.poolUsers -= 1;

    // Em dev/hot-reload pode haver múltiplas instâncias.
    // Só encerra o pool quando for a última.
    if (PrismaService.poolUsers <= 0) {
      await PrismaService.pool?.end().catch(() => undefined);
      PrismaService.pool = null;
      PrismaService.poolUsers = 0;
    }
  }
}