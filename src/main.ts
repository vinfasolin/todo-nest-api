import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function logFatal(err: unknown, origin: string) {
  console.error(`\n🔥 FATAL (${origin})`);
  console.error(err);
}

function parseCorsOrigins(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function bootstrap() {
  process.on('uncaughtException', (err) => logFatal(err, 'uncaughtException'));
  process.on('unhandledRejection', (reason) =>
    logFatal(reason, 'unhandledRejection'),
  );

  const app = await NestFactory.create(AppModule);

  const port = Number(process.env.PORT) || 3000;

  // ✅ CORS (produção): usa whitelist via env
  // Ex: CORS_ORIGINS="http://127.0.0.1:5179,http://localhost:5179,https://seusite.com"
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);

  app.enableCors({
    origin: (origin, callback) => {
      // requests sem Origin (curl/postman) => permite
      if (!origin) return callback(null, true);

      // se não definiu whitelist, por segurança bloqueia browsers
      if (corsOrigins.length === 0) return callback(new Error('CORS blocked'), false);

      if (corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    optionsSuccessStatus: 204,
  });

  // Log seguro (não expõe segredos)
  console.log('ENV:', {
    PORT: port,
    HAS_DATABASE_URL: Boolean(process.env.DATABASE_URL?.trim()),
    HAS_JWT_SECRET: Boolean(process.env.JWT_SECRET?.trim()),
    HAS_GOOGLE_CLIENT_ID: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
    CORS_ORIGINS: corsOrigins,
  });

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 API running on http://0.0.0.0:${port}`);
}

bootstrap().catch((err) => {
  logFatal(err, 'bootstrap.catch');
  process.exit(1);
});