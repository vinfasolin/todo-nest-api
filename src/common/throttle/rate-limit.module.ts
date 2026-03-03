// src/common/throttle/rate-limit.module.ts
import { Global, Module } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";

type AnyThrottlerModuleOptions = any;
type AnyThrottlerStorage = any;

function createFallbackStorage(): AnyThrottlerStorage {
  const hits = new Map<string, { count: number; expiresAt: number }>();

  return {
    // Algumas versões chamam increment com args extras:
    // increment(key, ttl, limit, blockDuration?, throttlerName?)
    async increment(
      key: string,
      ttl: number,
      limit: number,
      ..._rest: any[]
    ) {
      const now = Date.now();
      const ttlMs = ttl > 1000 ? ttl : ttl * 1000; // aceita segundos ou ms

      const entry = hits.get(key);
      if (!entry || entry.expiresAt <= now) {
        hits.set(key, { count: 1, expiresAt: now + ttlMs });
        return {
          totalHits: 1,
          timeToExpire: ttlMs,
          isBlocked: 1 > limit,
        };
      }

      entry.count += 1;
      return {
        totalHits: entry.count,
        timeToExpire: Math.max(0, entry.expiresAt - now),
        isBlocked: entry.count > limit,
      };
    },
  };
}

@Global()
@Module({
  imports: [
    // ✅ Na sua versão, o formato correto é ThrottlerModuleOptions:
    // { throttlers: [...] }
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: "default",
          ttl: 60, // segundos
          limit: 120, // 120 req/min por IP
        },
      ],
    } as AnyThrottlerModuleOptions),
  ],
  providers: [
    /**
     * ✅ Options num token estável pro seu guard custom
     * (o ThrottlerGuard no construtor espera o MESMO shape do forRoot)
     */
    {
      provide: "APP_THROTTLER_OPTIONS",
      useFactory: (): AnyThrottlerModuleOptions => ({
        throttlers: [
          {
            name: "default",
            ttl: 60,
            limit: 120,
          },
        ],
      }),
    },

    /**
     * ✅ Storage num token estável pro seu guard custom
     * Tentamos resolver a storage real registrada pelo ThrottlerModule.
     * Se não achar, cai no fallback (não quebra DI/testes).
     */
    {
      provide: "APP_THROTTLER_STORAGE",
      useFactory: (moduleRef: ModuleRef): AnyThrottlerStorage => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const throttlerPkg = require("@nestjs/throttler");

        // 1) tenta por CLASSE (varia por versão)
        const classCandidates: any[] = [
          throttlerPkg.ThrottlerStorageService,
          throttlerPkg.ThrottlerStorage,
        ].filter(Boolean);

        for (const cls of classCandidates) {
          try {
            const storage = moduleRef.get(cls, { strict: false });
            if (storage) return storage;
          } catch {}
        }

        // 2) tenta por tokens string (variantes comuns)
        const tokenCandidates: any[] = [
          "THROTTLER_STORAGE",
          "THROTTLER:STORAGE",
          "THROTTLER_STORAGE_PROVIDER",
          "ThrottlerStorageService",
          "ThrottlerStorage",
        ];

        for (const token of tokenCandidates) {
          try {
            const storage = moduleRef.get(token, { strict: false });
            if (storage) return storage;
          } catch {}
        }

        // 3) fallback (seguro pra não quebrar unit/e2e)
        return createFallbackStorage();
      },
      inject: [ModuleRef],
    },
  ],
  exports: [ThrottlerModule, "APP_THROTTLER_OPTIONS", "APP_THROTTLER_STORAGE"],
})
export class RateLimitModule {}