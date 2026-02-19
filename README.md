# todo-nest-api — NestJS + Prisma v7 + Neon Postgres + Google Auth (ID Token → API JWT)

API de To-Dos com autenticação via **Google ID Token** e autorização via **JWT próprio da API** (Bearer).  
Deploy em **Render** e banco em **Neon Postgres** com **Prisma v7** (`@prisma/adapter-pg` + `pg` Pool).

- Produção: `https://todo-nest-api-p6b1.onrender.com`
- Local: `http://localhost:3000`

---

## O que o sistema faz

- **Auth Google**: `POST /auth/google`
  - recebe `{ idToken }` (ID Token do Google)
  - valida com `google-auth-library`
  - upsert do `User` (por `googleSub`)
  - retorna `token` (JWT da API, 7 dias) + `user`
- **Perfil**: `GET /me` (Bearer JWT da API)
- **To-Dos por usuário**: `GET/POST/PATCH/DELETE /todos` (Bearer JWT da API)
- **Health**:
  - `GET /` → `"OK"`
  - `GET /db` → query rápida em `playing_with_neon`

---

## Stack

- Node.js (22+ recomendado)
- NestJS 11
- Prisma v7 + `@prisma/adapter-pg`
- Neon Postgres
- `google-auth-library`
- `@nestjs/jwt`
- Render (deploy)

---

## Estrutura

```
src/
  main.ts
  app.module.ts
  app.controller.ts
  app.service.ts

  prisma/
    prisma.module.ts
    prisma.service.ts

  auth/
    auth.module.ts
    auth.controller.ts
    google.strategy.ts
    jwt.guard.ts

  users/
    users.module.ts
    users.controller.ts

  todos/
    todos.module.ts
    todos.controller.ts   (pode estar duplicado dependendo do wiring)
    todos.service.ts      (pode estar duplicado dependendo do wiring)

prisma/
  schema.prisma
  migrations/
```

---

## Variáveis de ambiente (.env)

Crie `.env` na raiz:

```env
DATABASE_URL="postgresql://USER:SENHA@HOST-pooler.neon.tech/DB?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://USER:SENHA@HOST.neon.tech/DB?sslmode=require"

JWT_SECRET="uma_senha_forte_aqui"
GOOGLE_CLIENT_ID="7647....apps.googleusercontent.com"

PORT=3000

# vírgula (sem / no final)
CORS_ORIGINS="http://localhost:8081,http://localhost:5179"
```

> `DATABASE_URL` é obrigatória: a API falha no boot sem ela.

---

## Instalação e execução (local)

```bash
npm install
npm run prisma:generate
npm run start:dev
```

---

## Scripts

- `npm run build` → `prisma generate && nest build`
- `npm run start` / `start:prod` → `node dist/src/main.js`
- `npm run start:dev` → `nest start --watch`
- `npm run prisma:migrate:deploy` → migrations em produção (se aplicável)
- `npm test` / `npm run test:e2e`

---

## Endpoints

Base: local `http://localhost:3000` | prod `https://todo-nest-api-p6b1.onrender.com`

### Health
- `GET /` → `"OK"`
- `GET /db` → `{ ok: true, rows: [...] }`

### Auth
**POST `/auth/google`**
```json
{ "idToken": "GOOGLE_ID_TOKEN_AQUI" }
```
Resposta:
```json
{ "ok": true, "token": "JWT_DA_API", "user": { "id":"...", "googleSub":"...", "email":"..." } }
```

### User
**GET `/me`** (Bearer)
```http
Authorization: Bearer <JWT_DA_API>
```
Resposta:
```json
{ "ok": true, "user": { "id":"...", "email":"...", "googleSub":"..." } }
```

### To-Dos
**GET `/todos`** (Bearer) → `{ ok:true, items: Todo[] }`  
**POST `/todos`** (Bearer) body `{ title, description? }` → `{ ok:true, todo }`  
**PATCH `/todos/:id`** (Bearer) body `{ title?, description?, done? }` → `{ ok:true, todo }`  
**DELETE `/todos/:id`** (Bearer) → `{ ok:true }`

---

## Testes (atenção)

Seus testes (unit/e2e) ainda esperam `"Hello World!"` no `GET /`, mas a API real retorna `"OK"`.
Atualize:
- `src/app.controller.spec.ts`
- `test/app.e2e-spec.ts`

---

## Deploy no Render (checklist)

1) Serviço Node no Render  
2) **Build Command**:
```bash
npm install && npm run build
```
3) **Start Command**:
```bash
npm run start:prod
```
4) Env vars no Render:
- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `CORS_ORIGINS`
- `PORT` (Render geralmente injeta)

5) Migrações (se usar):
```bash
npm run prisma:migrate:deploy
```

---

## Troubleshooting

- **CORS**: configure `CORS_ORIGINS` com domínios exatos; o `main.ts` responde `OPTIONS 204`.
- **401 Missing Bearer token**: faltou header `Authorization`.
- **401 Invalid or expired Google ID token**: token expirou ou `GOOGLE_CLIENT_ID` não bate com `aud`.
- **DATABASE_URL is missing**: faltou env.

---

## Próximos passos recomendados

- Remover duplicação do módulo Todos (manter padrão separado).
- Swagger `/docs` (`@nestjs/swagger`).
- DTOs + `class-validator`.
- Endpoint `/health` dedicado.

---

## Licença
UNLICENSED
