# todo-nest-api — NestJS 11 + Prisma v7 + Neon Postgres + Auth (Google + Local) + Reset de Senha

API de **To‑Dos** com autenticação via **Google ID Token** *e* via **email/senha**, autorização via **JWT próprio da API** (Bearer) e fluxo **“Esqueci minha senha”** com envio de e‑mail (API externa PHP).  
Deploy em **Render** e banco em **Neon Postgres** com **Prisma v7**.

- **Produção:** `https://todo-nest-api-p6b1.onrender.com`
- **Local:** `http://localhost:3000`

---

## O que o sistema faz

### Autenticação (2 modos)

#### 1) Google Login — `POST /auth/google`
- body: `{ idToken }` (Google ID Token)
- valida com `google-auth-library`
- cria/atualiza usuário
- se existir usuário **local** com mesmo email, a API **vincula** a conta (preenche `googleSub`)
- retorna `{ ok:true, token, user }`

**Regras (Google):**
- conta Google **não pode** alterar **email** nem **senha** via API
- pode alterar **name** e **picture**

#### 2) Registro local — `POST /auth/register`
- body: `{ email, password, name? }`
- cria usuário com `passwordHash` (`bcrypt`)
- se já existir usuário do Google com mesmo email (sem senha), faz “upgrade” adicionando senha
- retorna `{ ok:true, token, user }`

#### 3) Login local — `POST /auth/login`
- body: `{ email, password }`
- valida senha (`bcrypt.compare`)
- retorna `{ ok:true, token, user }`

---

## Esqueci minha senha (público)

Fluxo em 2 etapas (sem JWT):

#### 1) Solicitar código — `POST /auth/forgot-password`
- body: `{ email }`
- sempre retorna `{ ok:true }` (anti-enumeração)
- **somente contas locais** recebem código (conta Google não recebe)

#### 2) Confirmar e definir nova senha — `POST /auth/reset-password`
- body: `{ email, code, newPassword }`
- código expira em **15 minutos**
- altera `passwordHash` e marca o código como usado

> Envio de e‑mail é feito via API externa (PHP) configurada em env vars.

---

## Recursos protegidos (Bearer JWT)

Header:
```http
Authorization: Bearer <JWT_DA_API>
```

- **Perfil**: `GET /me`
- **Editar perfil**: `PATCH /me` (name/picture)
- **Alterar email**: `PATCH /me/email` (**somente conta local**; retorna token novo)
- **Alterar senha**: `PATCH /me/password` (**somente conta local**)
- **Excluir conta**: `DELETE /me` (conta local exige password)
- **To‑Dos por usuário**:
  - `GET /todos` (paginado + busca/filtro server-side ✅)
  - `POST /todos`
  - `PATCH /todos/:id`
  - `DELETE /todos/:id`
  - `DELETE /todos/bulk` (**excluir em massa por filtro/busca ✅**)
  - `DELETE /todos` (**excluir tudo ✅**)

---

## Health / Debug
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
- `bcrypt`
- Render (deploy)
- Integração e‑mail: API PHP externa (PHPMailer)

---

## Estrutura

```txt
src/
  main.ts
  app.module.ts

  prisma/
    prisma.module.ts
    prisma.service.ts

  auth/
    auth.module.ts
    auth.controller.ts
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

  todos/
    todos.module.ts
    todos.controller.ts
    todos.service.ts

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

# ✅ E-mail (reset de senha)
EMAIL_API_BASE_URL="https://armazenamentoarquivos.com.br/api-email"
EMAIL_FROM_NAME="ToDo Premium"
# opcional se ativar no PHP:
EMAIL_API_KEY=""
```

---

## Banco de dados (Prisma schema)

### User
- `googleSub` opcional (`String?`)
- `passwordHash` opcional (`String?`)

Permite:
- conta **Google-only** (`googleSub != null`, `passwordHash == null`)
- conta **Local-only** (`googleSub == null`, `passwordHash != null`)
- conta **vinculada** (`googleSub != null`, `passwordHash != null`)

### Todo (cursor composto recomendado)
Para paginação estável com cursor composto, adicione no model `Todo`:

```prisma
@@unique([userId, createdAt, id])
```

Isso gera a chave única `userId_createdAt_id`, usada pelo `TodosService` para cursor composto.

### PasswordReset
Tabela de códigos do reset:
- `codeHash` (sha256 do código)
- `expiresAt` (15 min)
- `usedAt` (marca usado)
- relação `User 1:N PasswordReset`

---

## Instalação e execução (local)

```bash
npm install
npx prisma generate
npm run start:dev
```

Criar/atualizar schema local:

```bash
npx prisma migrate dev
npx prisma generate
```

> No Windows PowerShell, evite `&&` — use uma linha por comando.

---

## Deploy no Render (migrations)

**Build Command (recomendado):**
```bash
npm install && npm run build && npx prisma migrate deploy
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
- `PORT` (Render geralmente injeta)

---

## Endpoints

Base: local `http://localhost:3000` | prod `https://todo-nest-api-p6b1.onrender.com`

### Auth

#### POST `/auth/register`
Body:
```json
{ "email": "teste@teste.com", "password": "123456", "name": "Opcional" }
```

#### POST `/auth/login`
Body:
```json
{ "email": "teste@teste.com", "password": "123456" }
```

#### POST `/auth/google`
Body:
```json
{ "idToken": "GOOGLE_ID_TOKEN_AQUI" }
```

---

## To‑Dos (Bearer)

### GET `/todos` — paginado + busca/filtro server-side ✅

Query params:
- `take` (opcional): itens por página (**padrão 10**, min 1, max 50)
- `limit` (alias de `take`)
- `cursor` (opcional): **cursor composto** `createdAtISO|id` (recomendado)
  - compat: `cursor=<id>` (antigo; funciona, mas não é o ideal)
- `q` (opcional): termo de busca (title/description, case-insensitive)
- `search` (alias de `q`)
- `filter` (opcional): `all` | `open` | `done`
- `status` (alias de `filter`)
- `done` (compat): `true|false|1|0|yes|no` (se informado, tem prioridade sobre filter/status)

Resposta:
```json
{
  "ok": true,
  "items": [
    { "id":"...", "title":"...", "description":null, "done":false, "createdAt":"...", "updatedAt":"..." }
  ],
  "nextCursor": "2026-02-24T12:34:56.789Z|ckxyz..."
}
```

**Ordenação (estável):** `createdAt desc` + `id desc`

Exemplos:
- Primeira página:
```http
GET /todos?take=10
```

- Próxima página:
```http
GET /todos?take=10&cursor=<nextCursor>
```

- Buscar no servidor:
```http
GET /todos?take=10&q=mercado
```

- Filtrar pendentes:
```http
GET /todos?filter=open
```

- Concluídas + busca:
```http
GET /todos?filter=done&q=relatorio
```

---

### POST `/todos`
Body:
```json
{ "title": "Minha tarefa", "description": "opcional" }
```

Resposta:
```json
{ "ok": true, "todo": { "id":"...", "title":"...", "description":null, "done":false, "createdAt":"...", "updatedAt":"..." } }
```

---

### PATCH `/todos/:id`
Body:
```json
{ "title": "Novo título", "description": null, "done": true }
```

Resposta:
```json
{ "ok": true, "todo": { "id":"...", "title":"...", "done":true, "createdAt":"...", "updatedAt":"..." } }
```

---

### DELETE `/todos/:id`
Resposta:
```json
{ "ok": true }
```

---

### DELETE `/todos/bulk` — excluir em massa por filtro/busca ✅

Query params (mesmos aliases do GET):
- `filter` / `status`
- `q` / `search`
- `done` (tem prioridade)

Exemplos:
- Excluir todas as concluídas:
```http
DELETE /todos/bulk?filter=done
```

- Excluir por busca:
```http
DELETE /todos/bulk?q=teste
```

- Excluir pendentes por busca:
```http
DELETE /todos/bulk?status=open&q=mercado
```

Resposta:
```json
{ "ok": true, "deleted": 42 }
```

---

### DELETE `/todos` — excluir TUDO ✅

Exemplo:
```http
DELETE /todos
```

Resposta:
```json
{ "ok": true, "deleted": 123 }
```

---

## Testes (atenção)

Se seus testes esperarem `"Hello World!"` no `GET /`, atualize para `"OK"` em:
- `src/app.controller.spec.ts`
- `test/app.e2e-spec.ts`

---

## Troubleshooting

- **CORS**: configure `CORS_ORIGINS` com domínios exatos; o `main.ts` responde `OPTIONS 204`.
- **401 Missing Bearer token**: faltou `Authorization: Bearer ...`.
- **401 sessão expirada**: JWT expirou ou inválido.
- **500 em produção**: migration não aplicada no Neon → use `npx prisma migrate deploy` no Render.
- **EMAIL_API_BASE_URL ausente**: reset de senha falha ao enviar e‑mail.
- **DATABASE_URL ausente**: API falha no boot.

---

## Licença
UNLICENSED
