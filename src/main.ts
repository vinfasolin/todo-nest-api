import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Tipos do Express (já existe no projeto via @types/express)
import type { Request, Response, NextFunction } from 'express';
//src/main.ts
function logFatal(err: unknown, origin: string) {
  console.error(`\n🔥 FATAL (${origin})`);
  console.error(err);
}

function parseCorsOrigins(raw: string | undefined): string[] {
  const v = (raw || '').trim();
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeOrigin(o: string) {
  // remove "/" final e normaliza
  return String(o || '').trim().replace(/\/$/, '');
}

async function bootstrap() {
  // garante que qualquer crash apareça no terminal
  process.on('uncaughtException', (err) => logFatal(err, 'uncaughtException'));
  process.on('unhandledRejection', (reason) =>
    logFatal(reason, 'unhandledRejection'),
  );

  const app = await NestFactory.create(AppModule);

  const port = Number(process.env.PORT) || 3000;

  // ✅ Origens permitidas (Render deve setar CORS_ORIGINS)
  const envOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);

  // ✅ fallback local (se não setar nada)
  // Inclui Vite (5173/5179) e Expo Web (8081)
  const fallbackOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5179',
    'http://127.0.0.1:5179',
    'http://localhost:8081',
    'http://127.0.0.1:8081',
  ];

  const allowedOrigins = (envOrigins.length ? envOrigins : fallbackOrigins).map(
    normalizeOrigin,
  );

  const allowedSet = new Set(allowedOrigins);

  // ✅ CORS "na unha" (robusto e garante preflight OPTIONS sem 404)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = normalizeOrigin(String(req.headers.origin || ''));

    // Se o origin estiver na lista permitida, devolve ele; senão não seta nada.
    if (origin && allowedSet.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin'); // importante p/ cache/CDN
    }

    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PATCH,DELETE,OPTIONS',
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'content-type,authorization',
    );
    res.setHeader('Access-Control-Max-Age', '86400');

    // ✅ Responde preflight sem cair em controller
    if (req.method === 'OPTIONS') {
      return res.status(204).send();
    }

    return next();
  });

  // Log seguro (não expõe segredos)
  console.log('ENV:', {
    PORT: port,
    HAS_DATABASE_URL: Boolean(process.env.DATABASE_URL?.trim()),
    HAS_JWT_SECRET: Boolean(process.env.JWT_SECRET?.trim()),
    HAS_GOOGLE_CLIENT_ID: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
    CORS_ORIGINS: allowedOrigins,
  });

  // Render precisa 0.0.0.0 (não localhost)
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 API running on http://0.0.0.0:${port}`);
}

// não deixe bootstrap “solto” (senão o erro some)
bootstrap().catch((err) => {
  logFatal(err, 'bootstrap.catch');
  process.exit(1);
});
