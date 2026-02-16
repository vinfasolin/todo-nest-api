import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function logFatal(err: unknown, origin: string) {
  console.error(`\n🔥 FATAL (${origin})`);
  console.error(err);
}

async function bootstrap() {
  // garante que qualquer crash apareça no terminal
  process.on('uncaughtException', (err) => logFatal(err, 'uncaughtException'));
  process.on('unhandledRejection', (reason) => logFatal(reason, 'unhandledRejection'));

  const app = await NestFactory.create(AppModule);

  const port = Number(process.env.PORT) || 3000;

  // Log seguro (não expõe segredos)
  console.log('ENV:', {
    PORT: port,
    HAS_DATABASE_URL: Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim()),
    HAS_JWT_SECRET: Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.trim()),
    HAS_GOOGLE_CLIENT_ID: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID.trim()),
  });

  // Render precisa 0.0.0.0
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 API running on http://0.0.0.0:${port}`);
}

// não deixe bootstrap “solto” (senão o erro some)
bootstrap().catch((err) => {
  logFatal(err, 'bootstrap.catch');
  process.exit(1);
});