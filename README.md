# todo-nest-api — ToDo Premium API (NestJS 11 • Prisma v7 • Neon Postgres)

API de **To‑Dos** com autenticação **Google** *(ID Token)* **e** **email/senha**, autorização via **JWT próprio (Bearer)** e fluxo **“Esqueci minha senha”** com envio de e‑mail via **API externa (PHP)**.  
Deploy em **Render** e banco **Neon Postgres** com **Prisma v7** usando **`pg` Pool + `@prisma/adapter-pg`**.

- **Produção:** `https://todo-nest-api-p6b1.onrender.com`
- **Local:** `http://localhost:3000`
- **Swagger UI:** `/docs` (ex.: `http://localhost:3000/docs`)
- **OpenAPI JSON:** `/openapi.json` (ex.: `http://localhost:3000/openapi.json`)

> ⚠️ Segurança: nunca commite segredos/URLs reais. Se algo vazar, **gere novas credenciais** (Neon/Google) e atualize o Render.

---

## Sumário

- [O que a API entrega](#o-que-a-api-entrega)
- [Auth (Google + Local)](#auth-google--local)
- [Reset de senha](#reset-de-senha)
- [Endpoints](#endpoints)
- [Paginação / filtros em `/todos`](#paginacao--filtros-em-todos)
- [Erros padrão](#erros-padrao)
- [Rate limiting (throttling)](#rate-limiting-throttling)
- [Instalação e execução (local)](#instalacao-e-execucao-local)
- [Banco de dados (Prisma)](#banco-de-dados-prisma)
- [Deploy no Render](#deploy-no-render)
- [Testes](#testes)
- [Troubleshooting](#troubleshooting)
- [Licença](#licenca)

---

## O que a API entrega

- **Auth**
  - Google: troca **Google ID Token → JWT da API**
  - Local: **register/login** com senha hash (`bcrypt`)
- **Usuário**
  - `GET /me` e atualizações de perfil
  - regras: conta Google não altera email/senha; conta local pode
- **To‑Dos**
  - CRUD completo
  - **paginação cursor-based** com cursor composto `createdAt|id`
  - **busca/filtro server-side** (`q`, `filter`, `done`)
  - **totais** `totalAll` e `totalFiltered`
  - **bulk delete** (`DELETE /todos/bulk`) e **delete all** (`DELETE /todos`)
- **Documentação**
  - Swagger UI em `/docs`
  - OpenAPI em `/openapi.json`
- **Infra**
  - `ValidationPipe` global com erro **422**
  - filtro global de exceções (HTTP + Prisma) com payload padronizado
  - hardening: `helmet` + `compression` (no `main.ts`)

---

## Auth (Google + Local)

### 1) Google Login — `POST /auth/google`
- body: `{ "idToken": "..." }`
- valida com `google-auth-library`
- cria/atualiza usuário
- se existir usuário **local** com mesmo email, a API **vincula** (`googleSub`)
- retorna `{ ok:true, token, user }`

**Regras (Google):**
- conta Google **não pode** alterar **email** nem **senha**
- pode alterar **name** e **picture**

> **Audience/Client ID:** o verifier usa `GOOGLE_CLIENT_ID` do `.env` e fallback compatível entre ambientes.

### 2) Registro local — `POST /auth/register`
- body: `{ email, password, name? }`
- cria usuário com `passwordHash` (`bcrypt`)
- se já existir usuário Google com mesmo email (sem senha), faz “upgrade” adicionando senha
- retorna `{ ok:true, token, user }`

### 3) Login local — `POST /auth/login`
- body: `{ email, password }`
- valida senha (`bcrypt.compare`)
- retorna `{ ok:true, token, user }`

---

## Reset de senha

Fluxo público em 2 etapas (sem JWT). **Anti-enumeração**: o `forgot-password` sempre retorna `{ ok:true }`.

### 1) Solicitar código — `POST /auth/forgot-password`
- body: `{ email }`
- **somente contas locais** recebem código (conta Google não recebe)

### 2) Confirmar e definir nova senha — `POST /auth/reset-password`
- body: `{ email, code, newPassword }`
- código expira em **15 minutos**
- altera `passwordHash` e marca o código como usado

> Envio de e‑mail: API externa (PHP) configurada via env vars (`EMAIL_API_*`).

---

## Endpoints

### Header de autenticação (Bearer JWT)

```http
Authorization: Bearer <JWT_DA_API>
```

### Health / Debug
- `GET /` → `"OK"`
- `GET /db` → query rápida em `playing_with_neon`

### Auth (público)
- `POST /auth/register` `{ email, password, name? }`
- `POST /auth/login` `{ email, password }`
- `POST /auth/google` `{ idToken }`
- `POST /auth/forgot-password` `{ email }`
- `POST /auth/reset-password` `{ email, code, newPassword }`

### Users (Bearer)
- `GET /me`
- `PATCH /me` `{ name?: string|null, picture?: string|null }`
- `PATCH /me/email` `{ newEmail, password }` *(somente conta local; retorna token novo)*
- `PATCH /me/password` `{ currentPassword, newPassword }` *(somente conta local)*
- `DELETE /me` `{ password? }` *(conta local exige password)*

### To‑Dos (Bearer)
- `GET /todos` — paginado + busca/filtro + totais
- `GET /todos/:id`
- `POST /todos` `{ title, description? }`
- `PATCH /todos/:id` `{ title?, description?, done? }`
- `DELETE /todos/:id`
- `DELETE /todos/bulk` — bulk delete por filtro/busca
- `DELETE /todos` — removeAll

---

## Paginação / filtros em `/todos`

### Query params
- `take` (opcional): itens por página (**padrão 10**, min 1, max 50)
- `limit` (alias de `take`)
- `cursor` (opcional): **cursor composto** `createdAtISO|id` *(recomendado)*
  - compat: `cursor=<id>` (antigo; funciona, mas não é o ideal)
- `q` (opcional): termo de busca (title/description, case-insensitive)
- `search` (alias de `q`)
- `filter` (opcional): `all` | `open` | `done`
- `status` (alias de `filter`)
- `done` (compat): `true|false|1|0|yes|no` *(se informado, tem prioridade)*

### Resposta
```json
{
  "ok": true,
  "items": [
    { "id":"...", "title":"...", "description":null, "done":false, "createdAt":"...", "updatedAt":"..." }
  ],
  "nextCursor": "2026-02-24T12:34:56.789Z|ckxyz...",
  "totalAll": 120,
  "totalFiltered": 12,
  "total": 12
}
```

**Uso no app (regra simples):**
- sem filtro/busca → use `totalAll`
- com filtro/busca → use `totalFiltered`

---

## Erros padrão

A API padroniza erros como:

```json
{
  "ok": false,
  "error": "VALIDATION_ERROR",
  "message": "title is required",
  "statusCode": 422,
  "path": "/todos",
  "method": "POST",
  "timestamp": "2026-03-03T14:22:55.168Z",
  "details": { "fields": { "body.title": ["title is required"] } }
}
```

- **422**: validação de DTO (`ValidationPipe` global)
- **409**: conflito (ex.: Prisma `P2002` → `PRISMA_UNIQUE_CONSTRAINT`)
- **404**: recurso não encontrado
- **401/403**: auth/permissão
- **500**: erro interno (genérico)

---

## Rate limiting (throttling)

O projeto usa `@nestjs/throttler` com configuração global via **`RateLimitModule`** e um guard global customizado (**`ThrottlerSkipGuard`**) que respeita `@SkipThrottle()`.

- Configuração padrão (global): **120 req / 60s por IP** (`name: "default"`)
- Rotas podem ter throttling específico com `@Throttle(...)`
- Rotas/Controllers podem ignorar throttling com `@SkipThrottle()`

> Observação: foi ajustado para compatibilidade com a versão do `@nestjs/throttler` usada (sem depender de tokens internos instáveis).

---

## Swagger / OpenAPI

- Swagger UI: **`/docs`**
- OpenAPI JSON: **`/openapi.json`** *(import direto no Postman)*

Exemplos:
- Local: `http://localhost:3000/docs` e `http://localhost:3000/openapi.json`
- Produção: `https://todo-nest-api-p6b1.onrender.com/docs` e `https://todo-nest-api-p6b1.onrender.com/openapi.json`

> Dica (Render): defina `RENDER_EXTERNAL_URL` (ex.: `https://todo-nest-api-p6b1.onrender.com`) para o Swagger listar a URL pública como servidor “Current”.

---

## Estrutura

```txt
src/
  main.ts
  app.module.ts

  common/
    filters/
      all-exceptions.filter.ts
    throttle/
      rate-limit.module.ts
      skip-throttle.decorator.ts
      throttler-skip.guard.ts

  prisma/
    prisma.module.ts
    prisma.service.ts

  auth/
    auth.module.ts
    auth.controller.ts
    dto/
      auth.dto.ts
    google.strategy.ts
    jwt.guard.ts
    password-reset.service.ts

  mail/
    mail.module.ts
    mail.service.ts

  users/
    users.module.ts
    users.controller.ts
    users.service.ts
    dto/
      users.dto.ts

  todos/
    todos.module.ts
    todos.controller.ts
    todos.service.ts
    dto/
      todos.dto.ts

  types/
    express.d.ts

prisma/
  schema.prisma
  migrations/

test/
  jest-e2e.json
  setup-e2e-env.ts
  app.e2e-spec.ts
```

---

## Variáveis de ambiente

### `.env` (local / produção)
Crie `.env` na raiz:

```env
DATABASE_URL="postgresql://USER:SENHA@HOST-pooler.neon.tech/DB?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://USER:SENHA@HOST.neon.tech/DB?sslmode=require"

JWT_SECRET="uma_senha_forte_aqui"
GOOGLE_CLIENT_ID="7647....apps.googleusercontent.com"

PORT=3000

# vírgula (sem / no final)
CORS_ORIGINS="http://localhost:8081,http://localhost:5173"

# E-mail (reset de senha)
EMAIL_API_BASE_URL="https://armazenamentoarquivos.com.br/api-email"
EMAIL_FROM_NAME="ToDo Premium"
# opcional se ativar no PHP:
EMAIL_API_KEY=""

# (Render) para logs/Swagger com URL pública correta
RENDER_EXTERNAL_URL="https://todo-nest-api-p6b1.onrender.com"

# SSL do pg (opcional):
# true = verifica certificado (mais seguro)
# false = mais compatível com alguns ambientes/chain
PG_SSL_REJECT_UNAUTHORIZED=false
```

### `.env.test` (E2E)
Crie `.env.test` na raiz com **DATABASE_URL de um banco de TESTE**:

```env
DATABASE_URL="postgresql://USER:SENHA@HOST-pooler.neon.tech/DB_TESTE?sslmode=require&uselibpqcompat=true"
JWT_SECRET="dev-secret-change-me"
GOOGLE_CLIENT_ID="7647....apps.googleusercontent.com"
EMAIL_API_BASE_URL="https://armazenamentoarquivos.com.br/api-email"
EMAIL_FROM_NAME="ToDo Premium"
CORS_ORIGINS="http://localhost:8081,http://localhost:5173"
PORT=3000
```

> No Windows, o Notepad às vezes salva `.env.test` em UTF‑16. O loader E2E lê **UTF‑8 ou UTF‑16LE** automaticamente.

---

## Instalação e execução (local)

```bash
npm install
npx prisma generate
npm run start:dev
```

Criar/atualizar migrations (dev):
```bash
npx prisma migrate dev
npx prisma generate
```

---

## Banco de dados (Prisma)

### User
- `googleSub` opcional (`String?`)
- `passwordHash` opcional (`String?`)

Permite:
- Google-only (`googleSub != null`, `passwordHash == null`)
- Local-only (`googleSub == null`, `passwordHash != null`)
- Vinculada (`googleSub != null`, `passwordHash != null`)

### Todo (cursor composto recomendado)
Para paginação estável com cursor composto:

```prisma
@@unique([userId, createdAt, id])
```

### PasswordReset
- `codeHash` (sha256 do código)
- `expiresAt` (15 min)
- `usedAt`

---

## PrismaService (pool + adapter-pg)

A API usa **Pool singleton** com `@prisma/adapter-pg`:
- evita múltiplas conexões em dev/hot reload
- encerra o pool quando a última instância é destruída
- SSL é aplicado quando não é claramente local
- `PG_SSL_REJECT_UNAUTHORIZED` controla a validação do certificado

---

## Deploy no Render

**Build Command (recomendado):**
```bash
npm ci && npx prisma generate && npx prisma migrate deploy && npm run build
```

**Start Command:**
```bash
npm run start:prod
```

Env vars no Render (mínimo):
- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `CORS_ORIGINS`
- `EMAIL_API_BASE_URL`
- `EMAIL_FROM_NAME`
- `EMAIL_API_KEY` (opcional)
- `RENDER_EXTERNAL_URL` (recomendado)
- `PORT` (Render normalmente injeta)

---

## Testes

### Unit tests
```bash
npm test
```

### E2E (end-to-end) — usando `.env.test`
Os testes E2E:
- criam usuário local
- testam `/me`
- criam/listam (paginação/totais)/atualizam/deletam To‑Dos
- testam bulk delete e removeAll
- testam forgot/reset password (com `MailService` **mockado**)

Rodar:
```bash
npm run test:e2e
```

---

## Exemplos rápidos (curl / PowerShell)

### Register (local)
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@teste.com","password":"123456","name":"Cláudio"}'
```

### Login (local)
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@teste.com","password":"123456"}'
```

### Listar To‑Dos (Bearer)
```bash
curl http://localhost:3000/todos?take=10 \
  -H "Authorization: Bearer <JWT_DA_API>"
```

### PowerShell (Invoke-RestMethod)
```powershell
$base="http://localhost:3000"
$body=@{ email="teste@teste.com"; password="123456" } | ConvertTo-Json
$res=Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body $body
$token=$res.token
Invoke-RestMethod -Method Get -Uri "$base/me" -Headers @{ Authorization = "Bearer $token" }
```

---

## Troubleshooting

- **CORS**: configure `CORS_ORIGINS` com domínios exatos; o `main.ts` responde `OPTIONS 204`.
- **401 Missing Bearer token**: faltou `Authorization: Bearer ...`.
- **500 em produção**: migrations não aplicadas → use `npx prisma migrate deploy` no Render.
- **Reset de senha falhando**: confira `EMAIL_API_BASE_URL` e `EMAIL_FROM_NAME` (e `EMAIL_API_KEY` se ativar).
- **Swagger com URL errada**: defina `RENDER_EXTERNAL_URL` no Render.

---

## Licença
UNLICENSED
