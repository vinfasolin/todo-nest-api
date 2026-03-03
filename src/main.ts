// src/main.ts
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

import { UnprocessableEntityException, ValidationPipe } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";

import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

// ✅ hardening (opcionais — instale se ainda não tiver)
import helmet from "helmet";
import compression from "compression";

// ✅ filtro global único (HTTP + Prisma + genéricos)
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

function logFatal(err: unknown, origin: string) {
  // eslint-disable-next-line no-console
  console.error(`\n🔥 FATAL (${origin})`);
  // eslint-disable-next-line no-console
  console.error(err);
}

function parseCorsOrigins(raw: string | undefined): string[] {
  const v = (raw || "").trim();
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeOrigin(o: string) {
  return String(o || "")
    .trim()
    .replace(/\/+$/, ""); // remove "/" finais
}

function computePublicBaseUrl(port: number): string {
  const renderExternal = process.env.RENDER_EXTERNAL_URL?.trim();
  if (renderExternal) return normalizeOrigin(renderExternal);

  const publicUrl =
    process.env.PUBLIC_URL?.trim() ||
    process.env.BASE_URL?.trim() ||
    process.env.APP_URL?.trim();
  if (publicUrl) return normalizeOrigin(publicUrl);

  return `http://localhost:${port}`;
}

// ✅ agora é recursivo: pega children -> children -> ...
function formatValidationErrors(errors: unknown) {
  const fields: Record<string, string[]> = {};

  const walk = (e: any, parentPath?: string) => {
    const prop = e?.property ? String(e.property) : undefined;
    const path =
      parentPath && prop ? `${parentPath}.${prop}` : prop || parentPath || "body";

    const msgs = e?.constraints ? Object.values(e.constraints) : [];
    if (msgs.length) {
      fields[path] = (fields[path] || []).concat(msgs.map(String));
    }

    const children = Array.isArray(e?.children) ? e.children : [];
    for (const c of children) walk(c, path);
  };

  const list = Array.isArray(errors) ? errors : [];
  for (const e of list) walk(e);

  const firstField = Object.keys(fields)[0];
  const firstMsg = firstField ? fields[firstField]?.[0] : undefined;

  return {
    message: firstMsg || "Validation error",
    fields,
  };
}

async function bootstrap() {
  process.on("uncaughtException", (err) => logFatal(err, "uncaughtException"));
  process.on("unhandledRejection", (reason) =>
    logFatal(reason, "unhandledRejection"),
  );

  const app = await NestFactory.create(AppModule);

  // ✅ Express instance (trust proxy / disable x-powered-by)
  // evita erro de TS (app.set / app.disable não existe em INestApplication)
  const expressApp = app.getHttpAdapter().getInstance();
  if (expressApp?.set) {
    expressApp.set("trust proxy", 1);
  }
  if (expressApp?.disable) {
    expressApp.disable("x-powered-by");
  }

  // ✅ encerra hooks corretamente (SIGTERM do Render)
  app.enableShutdownHooks();

  // ✅ hardening (headers) + compressão
  // Se você não quiser instalar, remova estes 2 app.use(...)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(compression());

  // ✅ ValidationPipe global (DTOs valendo de verdade)
  // ✅ Agora: validação -> 422
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: true,
      exceptionFactory: (errors) => {
        const { message, fields } = formatValidationErrors(errors);

        return new UnprocessableEntityException({
          ok: false,
          error: "VALIDATION_ERROR",
          message,
          fields,
        });
      },
    }),
  );

  // ✅ filtro global único (HTTP + Prisma + genéricos)
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT) || 3000;

  const envOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);

  const fallbackOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5179",
    "http://127.0.0.1:5179",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
  ];

  const allowedOrigins = (envOrigins.length ? envOrigins : fallbackOrigins)
    .map(normalizeOrigin)
    .filter(Boolean);

  const allowedSet = new Set(allowedOrigins);

  // ✅ CORS manual (preflight 204 e allow-origin apenas para origens permitidas)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = normalizeOrigin(String(req.headers.origin || ""));

    if (origin && allowedSet.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      // res.setHeader("Access-Control-Allow-Credentials", "true"); // só se usar cookies
    }

    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization,x-api-key");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      return res.status(204).send();
    }

    return next();
  });

  const publicBaseUrl = computePublicBaseUrl(port);

  // ✅ Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle("ToDo Premium API")
    .setDescription(
      [
        "API de To-Dos com Auth Google + Local, JWT próprio e reset de senha.",
        "",
        "Ambientes:",
        `- Produção: https://todo-nest-api-p6b1.onrender.com`,
        `- Local: http://localhost:${port}`,
      ].join("\n"),
    )
    .setVersion("1.0.0")
    .addServer(publicBaseUrl, "Current")
    .addServer("https://todo-nest-api-p6b1.onrender.com", "Production")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        in: "header",
        name: "Authorization",
        description: "Cole aqui: Bearer <JWT_DA_API>",
      },
      "access-token",
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey}_${methodKey}`,
  });

  // ✅ ADD: Schema de erro padrão + respostas padrão nas operações
  const ERROR_SCHEMA_NAME = "ErrorResponseDto";
  const errorSchemaRef = { $ref: `#/components/schemas/${ERROR_SCHEMA_NAME}` };

  document.components = document.components || {};
  (document.components as any).schemas = (document.components as any).schemas || {};

  (document.components as any).schemas[ERROR_SCHEMA_NAME] = {
    type: "object",
    properties: {
      ok: { type: "boolean", example: false },
      error: { type: "string", example: "VALIDATION_ERROR" },
      message: { type: "string", example: "Validation error" },
      statusCode: { type: "number", example: 422 },
      path: { type: "string", example: "/todos" },
      method: { type: "string", example: "POST" },
      timestamp: { type: "string", example: new Date().toISOString() },
      details: { type: "object", nullable: true },
    },
    required: ["ok", "error", "message", "statusCode", "path", "method", "timestamp"],
    additionalProperties: true,
  };

  function ensureResponse(op: any, status: string, description: string, example?: any) {
    op.responses = op.responses || {};
    if (op.responses[status]) return;

    const content: any = {
      "application/json": {
        schema: errorSchemaRef,
        ...(example ? { example } : {}),
      },
    };

    op.responses[status] = { description, content };
  }

  for (const pathKey of Object.keys(document.paths || {})) {
    const pathItem: any = (document.paths as any)[pathKey];
    for (const method of ["get", "post", "patch", "delete", "put"] as const) {
      const op: any = pathItem?.[method];
      if (!op) continue;

      const upperMethod = String(method).toUpperCase();

      // 401/403 apenas se tiver security
      const isProtected = Array.isArray(op.security) && op.security.length > 0;
      if (isProtected) {
        ensureResponse(op, "401", "JWT ausente/inválido", {
          ok: false,
          error: "HTTP_401",
          message: "Unauthorized",
          statusCode: 401,
          path: pathKey,
          method: upperMethod,
          timestamp: new Date().toISOString(),
        });
        ensureResponse(op, "403", "Acesso negado", {
          ok: false,
          error: "HTTP_403",
          message: "Forbidden",
          statusCode: 403,
          path: pathKey,
          method: upperMethod,
          timestamp: new Date().toISOString(),
        });
      }

      // ✅ 422: validação de DTO (principal)
      ensureResponse(op, "422", "Erro de validação (DTO)", {
        ok: false,
        error: "VALIDATION_ERROR",
        message: "Validation error",
        statusCode: 422,
        path: pathKey,
        method: upperMethod,
        timestamp: new Date().toISOString(),
        details: { fields: { title: ["title must be longer than or equal to 1 characters"] } },
      });

      // 400: só como genérico (BadRequest manual etc.) — mantém, mas não substitui 422
      ensureResponse(op, "400", "Requisição inválida (BadRequest)", {
        ok: false,
        error: "HTTP_400",
        message: "Bad Request",
        statusCode: 400,
        path: pathKey,
        method: upperMethod,
        timestamp: new Date().toISOString(),
      });

      ensureResponse(op, "404", "Recurso não encontrado", {
        ok: false,
        error: "HTTP_404",
        message: "Not Found",
        statusCode: 404,
        path: pathKey,
        method: upperMethod,
        timestamp: new Date().toISOString(),
      });

      ensureResponse(op, "409", "Conflito (ex.: unique constraint)", {
        ok: false,
        error: "PRISMA_UNIQUE_CONSTRAINT",
        message: "Unique constraint failed",
        statusCode: 409,
        path: pathKey,
        method: upperMethod,
        timestamp: new Date().toISOString(),
      });

      ensureResponse(op, "429", "Too Many Requests (rate limit)", {
        ok: false,
        error: "HTTP_429",
        message: "Too Many Requests",
        statusCode: 429,
        path: pathKey,
        method: upperMethod,
        timestamp: new Date().toISOString(),
      });

      ensureResponse(op, "500", "Erro interno", {
        ok: false,
        error: "INTERNAL_ERROR",
        message: "Unexpected error",
        statusCode: 500,
        path: pathKey,
        method: upperMethod,
        timestamp: new Date().toISOString(),
      });
    }
  }

  SwaggerModule.setup("docs", app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  app.use("/openapi.json", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(document);
  });

  // eslint-disable-next-line no-console
  console.log("ENV:", {
    PORT: port,
    HAS_DATABASE_URL: Boolean(process.env.DATABASE_URL?.trim()),
    HAS_JWT_SECRET: Boolean(process.env.JWT_SECRET?.trim()),
    HAS_GOOGLE_CLIENT_ID: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
    CORS_ORIGINS: allowedOrigins,
    PUBLIC_BASE_URL: publicBaseUrl,
    SWAGGER: { DOCS: "/docs", OPENAPI_JSON: "/openapi.json" },
  });

  await app.listen(port, "0.0.0.0");

  // eslint-disable-next-line no-console
  console.log(`🚀 API running on ${publicBaseUrl}`);
  // eslint-disable-next-line no-console
  console.log(`📚 Swagger UI: ${publicBaseUrl}/docs`);
  // eslint-disable-next-line no-console
  console.log(`🧾 OpenAPI JSON: ${publicBaseUrl}/openapi.json`);
}

bootstrap().catch((err) => {
  logFatal(err, "bootstrap.catch");
  process.exit(1);
});