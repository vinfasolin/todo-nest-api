# docs/ARCHITECTURE.md — todo-nest-api

Arquitetura interna: módulos, fluxo de auth, CORS, persistência e pontos de atenção.

---

## Mapa de módulos

- **AppModule**: compõe `PrismaModule`, `AuthModule`, `UsersModule`, `TodosModule`
- **PrismaModule** (Global): expõe `PrismaService`
- **AuthModule**: expõe `POST /auth/google`, `GoogleIdTokenVerifier`, `JwtModule`
- **UsersModule**: expõe `GET /me` (protegido por `JwtAuthGuard`)
- **TodosModule**: expõe `/todos` (protegido por `JwtAuthGuard`)

---

## CORS (src/main.ts)

O CORS é manual para garantir:
- Preflight **OPTIONS** sempre retorna **204**
- `Access-Control-Allow-Origin` apenas para origens permitidas
- `Vary: Origin` para evitar cache incorreto

### Origem permitida
- `CORS_ORIGINS` (env, separado por vírgula) **ou**
- fallback local (5173, 5179, 8081 etc)

Normalização remove `/` final do origin.

---

## Auth: Google ID Token → JWT da API

### `POST /auth/google`

1) Controller valida `idToken`  
2) `GoogleIdTokenVerifier.verify()` valida com `google-auth-library`:
- audiences = `[process.env.GOOGLE_CLIENT_ID, FALLBACK_CLIENT_ID]` (sem duplicatas)

3) Upsert user:
- `where: { googleSub: payload.sub }`
- `update/create`: email, name, picture

4) Emite JWT da API (7d):
```json
{ "uid": "<user.id>", "sub": "<user.id>", "email": "<user.email>" }
```

---

## Guard: `JwtAuthGuard`

- Lê `Authorization: Bearer <token>`
- `jwt.verifyAsync` com `JWT_SECRET`
- injeta em `req.user`:
```ts
{ uid: payload.uid || payload.sub, sub: payload.sub, email: payload.email }
```

---

## Persistência: Prisma v7 + pg Pool

`PrismaService`:
- exige `DATABASE_URL` no construtor
- cria `pg.Pool` singleton (static)
- `ssl: { rejectUnauthorized: false }`
- usa `PrismaPg(pool)` como adapter do Prisma v7
- lifecycle:
  - `onModuleInit` → `$connect`
  - `onModuleDestroy` → `$disconnect` + `pool.end`

---

## Modelos (schema.prisma)

### User
- `id` cuid PK
- `googleSub` unique
- `email` unique
- `name`, `picture` opcionais
- relação 1:N com Todo

### Todo
- `id` cuid PK
- `title` obrigatório
- `description` opcional
- `done` default false
- `userId` FK → User (onDelete Cascade)
- index `[userId]`

---

## To-Dos: validações e ownership

No service:
- `title` obrigatório e max 120
- `description` max 2000 (vazio → null)
- `done` precisa ser boolean
- update sem campos → 400
- update/delete checam ownership:
  - `findFirst({ where: { id, userId } })`
  - se não existir → 404

---

## Ponto de atenção: duplicação no módulo Todos

Você tem:
- arquivos separados (`todos.controller.ts` + `todos.service.ts`)
- e uma versão “all-in-one” dentro de `todos.module.ts` (define service+controller internos)

**Recomendação:** manter apenas um padrão (ideal: separado) para não divergir.

---

## Testes

Há desalinhamento:
- API: `GET /` retorna `"OK"`
- testes: esperam `"Hello World!"`

Ajuste `src/app.controller.spec.ts` e `test/app.e2e-spec.ts`.

---

## Evoluções recomendadas

- Swagger `/docs`
- DTO + `class-validator`
- `ConfigModule` para validar env
- `/health` dedicado + métricas
- remover duplicações e padronizar estrutura
