// test/app.e2e-spec.ts
import {
  INestApplication,
  ValidationPipe,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { createHash } from "crypto";

import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { MailService } from "../src/mail/mail.service";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

// ✅ mesmo shape do main.ts (recursivo, com children)
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

describe("ToDo Premium API (e2e)", () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;

  const email = `e2e_${Date.now()}@test.com`;
  const password = "123456";
  const newPassword = "654321";

  let token = "";
  let userId = "";
  let todoId = "";

  function requireApp(): INestApplication {
    if (!app) throw new Error("E2E app not initialized (beforeAll failed).");
    return app;
  }

  function requirePrisma(): PrismaService {
    if (!prisma) throw new Error("E2E prisma not initialized (beforeAll failed).");
    return prisma;
  }

  beforeAll(async () => {
    const dbUrl = String(process.env.DATABASE_URL || "").trim();
    if (!dbUrl) {
      throw new Error(
        "DATABASE_URL não está definido. Defina DATABASE_URL (banco de TESTE) antes do test:e2e.",
      );
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue({ send: jest.fn().mockResolvedValue({ ok: true }) })
      .compile();

    app = moduleRef.createNestApplication();

    // ✅ Necessário: alinhar com main.ts (validação retorna 422)
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

    // ✅ Necessário: alinhar shape de erro com o runtime (main.ts)
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();

    prisma = app.get(PrismaService);

    // limpeza defensiva por email
    const existing = await requirePrisma().user.findUnique({ where: { email } });
    if (existing) {
      await requirePrisma().$transaction([
        requirePrisma().todo.deleteMany({ where: { userId: existing.id } }),
        requirePrisma().passwordReset.deleteMany({ where: { userId: existing.id } }),
        requirePrisma().user.delete({ where: { id: existing.id } }),
      ]);
    }
  });

  afterAll(async () => {
    try {
      if (userId) {
        // ✅ sempre via requirePrisma (não usa prisma direto)
        await requirePrisma().$transaction([
          requirePrisma().todo.deleteMany({ where: { userId } }),
          requirePrisma().passwordReset.deleteMany({ where: { userId } }),
          requirePrisma().user.deleteMany({ where: { id: userId } }),
        ]);
      }
    } catch {
      // não falha o teardown
    }

    await app?.close();
  });

  it("POST /auth/register -> cria conta local e retorna JWT", async () => {
    const res = await request(requireApp().getHttpServer())
      .post("/auth/register")
      .send({ email, password, name: "E2E" })
      .expect(201);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.email).toBe(email);

    token = res.body.token;
    userId = res.body.user.id;
    expect(userId).toBeTruthy();
  });

  it("POST /auth/login -> autentica e retorna user sem passwordHash", async () => {
    const res = await request(requireApp().getHttpServer())
      .post("/auth/login")
      .send({ email, password })
      .expect(201);

    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.passwordHash).toBeUndefined();

    token = res.body.token;
  });

  it("GET /me -> retorna perfil com Bearer", async () => {
    const res = await request(requireApp().getHttpServer())
      .get("/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.user.id).toBe(userId);
    expect(res.body.user.email).toBe(email);
  });

  it("POST /todos -> cria todo", async () => {
    const res = await request(requireApp().getHttpServer())
      .post("/todos")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Primeiro", description: "Desc" })
      .expect(201);

    expect(res.body.ok).toBe(true);
    expect(res.body.todo.title).toBe("Primeiro");
    todoId = res.body.todo.id;
    expect(todoId).toBeTruthy();
  });

  // ✅ NOVO: garante 422 (profissional) em payload inválido
  it("POST /todos -> 422 (VALIDATION_ERROR) quando title não é enviado", async () => {
    const res = await request(requireApp().getHttpServer())
      .post("/todos")
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "sem title" })
      .expect(422);

    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(res.body.statusCode).toBe(422);

    // seu filter padroniza fields dentro de details
    expect(res.body.details).toBeTruthy();
    expect(res.body.details.fields).toBeTruthy();
    // normalmente será "title" (ou "body.title" dependendo do path que você monta)
  });

  // ✅ NOVO: GET /todos/:id (200)
  it("GET /todos/:id -> retorna o todo por id", async () => {
    const res = await request(requireApp().getHttpServer())
      .get(`/todos/${todoId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.todo).toBeTruthy();
    expect(res.body.todo.id).toBe(todoId);
  });

  // ✅ NOVO: GET /todos/:id (404)
  it("GET /todos/:id -> 404 quando não existe", async () => {
    const missingId = "ck_missing_todo_id_123";

    await request(requireApp().getHttpServer())
      .get(`/todos/${missingId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  // ✅ NOVO: GET /todos/:id (401)
  it("GET /todos/:id -> 401 sem token", async () => {
    await request(requireApp().getHttpServer()).get(`/todos/${todoId}`).expect(401);
  });

  it("GET /todos -> lista paginada com totals", async () => {
    await requirePrisma().todo.createMany({
      data: Array.from({ length: 12 }).map((_, i) => ({
        userId,
        title: `T${i + 1}`,
        description: null,
        done: i % 2 === 0,
      })),
    });

    const res = await request(requireApp().getHttpServer())
      .get("/todos?take=5")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeLessThanOrEqual(5);

    expect(typeof res.body.totalAll).toBe("number");
    expect(typeof res.body.totalFiltered).toBe("number");
    expect(res.body.total).toBe(res.body.totalFiltered);

    if (res.body.items.length === 5) {
      expect(typeof res.body.nextCursor).toBe("string");
    }
  });

  it("GET /todos com filtro=done e q=T -> retorna só done=true", async () => {
    const res = await request(requireApp().getHttpServer())
      .get("/todos?take=10&filter=done&q=T")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    for (const it of res.body.items) expect(it.done).toBe(true);
  });

  it("PATCH /todos/:id -> atualiza title/done", async () => {
    const res = await request(requireApp().getHttpServer())
      .patch(`/todos/${todoId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Atualizado", done: true })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.todo.title).toBe("Atualizado");
    expect(res.body.todo.done).toBe(true);
  });

  it("DELETE /todos/bulk -> deleta por filtro/busca", async () => {
    const res = await request(requireApp().getHttpServer())
      .delete("/todos/bulk?filter=done&q=T")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.deleted).toBe("number");
  });

  it("DELETE /todos/:id -> remove todo específico (cria um só para deletar)", async () => {
    const created = await request(requireApp().getHttpServer())
      .post("/todos")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "DELETE_ME", description: "x" })
      .expect(201);

    const idToDelete = created.body.todo.id;

    const res = await request(requireApp().getHttpServer())
      .delete(`/todos/${idToDelete}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it("POST /auth/forgot-password -> sempre ok (mail mockado)", async () => {
    const res = await request(requireApp().getHttpServer())
      .post("/auth/forgot-password")
      .send({ email })
      .expect(201);

    expect(res.body).toEqual({ ok: true });
  });

  it("POST /auth/reset-password -> reseta senha com código inserido via Prisma", async () => {
    const code = "123456";

    await requirePrisma().passwordReset.deleteMany({ where: { userId } });
    await requirePrisma().passwordReset.create({
      data: {
        userId,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const res = await request(requireApp().getHttpServer())
      .post("/auth/reset-password")
      .send({ email, code, newPassword })
      .expect(201);

    expect(res.body).toEqual({ ok: true });

    const login2 = await request(requireApp().getHttpServer())
      .post("/auth/login")
      .send({ email, password: newPassword })
      .expect(201);

    expect(login2.body.ok).toBe(true);
    expect(login2.body.token).toBeTruthy();
  });

  it("DELETE /todos -> removeAll", async () => {
    const res = await request(requireApp().getHttpServer())
      .delete("/todos")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.deleted).toBe("number");
  });

  it("401 sem token em rota protegida", async () => {
    await request(requireApp().getHttpServer()).get("/todos").expect(401);
  });
});