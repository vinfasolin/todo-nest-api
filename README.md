# todo-nest-api — NestJS + Prisma v7 + Neon Postgres + Auth Google + Auth Local + Reset de Senha (Email)

API de To-Dos com autenticação via **Google ID Token** *e* via **email/senha**, autorização via **JWT próprio da API** (Bearer) e fluxo **“Esqueci minha senha”** com envio de e-mail (API externa PHP).  
Deploy em **Render** e banco em **Neon Postgres** com **Prisma v7**.

- Produção: `https://todo-nest-api-p6b1.onrender.com`
- Local: `http://localhost:3000`

---

## O que o sistema faz

### Autenticação (2 modos)

#### 1) Google Login: `POST /auth/google`
- recebe `{ idToken }` (Google ID Token)
- valida com `google-auth-library`
- **cria ou atualiza** usuário
- **se existir usuário local com mesmo email**, a API **vincula** a conta (preenche `googleSub`)
- retorna `token` (JWT da API, 7 dias) + `user`

> Regras importantes (Google):
> - Conta Google **não pode** alterar **email** nem **senha** via API.
> - Pode alterar **name** e **picture**.

#### 2) Registro local: `POST /auth/register`
- recebe `{ email, password, name? }`
- cria usuário com `passwordHash` (bcrypt)
- se já existir usuário com mesmo email criado via Google (sem senha), faz “upgrade” adicionando senha
- retorna `token` + `user`

#### 3) Login local: `POST /auth/login`
- recebe `{ email, password }`
- valida a senha (`bcrypt.compare`)
- retorna `token` + `user` (sem vazar `passwordHash`)

---

## Esqueci minha senha (público)

Fluxo em 2 etapas (sem JWT):

#### 1) Solicitar código: `POST /auth/forgot-password`
- body: `{ email }`
- sempre retorna `{ ok: true }` (anti-enumeração)
- **somente contas locais** recebem código (conta Google não recebe)

#### 2) Confirmar e definir nova senha: `POST /auth/reset-password`
- body: `{ email, code, newPassword }`
- código expira em **15 minutos**
- altera `passwordHash` e marca o código como usado

> Envio de e-mail é feito via API externa (PHP) configurada em variáveis de ambiente.

---

## Recursos protegidos (Bearer JWT)

- **Perfil**: `GET /me`
- **Editar perfil**: `PATCH /me` (name/picture)
- **Alterar email**: `PATCH /me/email` (**somente conta local**)
- **Alterar senha**: `PATCH /me/password` (**somente conta local**)
- **Excluir conta**: `DELETE /me` (conta local exige password)
- **To-Dos por usuário**: `GET/POST/PATCH/DELETE /todos`

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
- Integração e-mail: API PHP externa (PHPMailer)

---

## Estrutura

```txt
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

> `DATABASE_URL` é obrigatória: a API falha no boot sem ela.  
> Se `EMAIL_API_BASE_URL` faltar, o fluxo de “Esqueci minha senha” falha ao enviar e-mail.

---

## Banco de dados (Prisma schema)

### User
- `googleSub` é **opcional** (`String?`)
- `passwordHash` é **opcional** (`String?`)

Isso permite:
- conta **Google-only** (`googleSub != null`, `passwordHash == null`)
- conta **Local-only** (`googleSub == null`, `passwordHash != null`)
- conta **vinculada** (`googleSub != null`, `passwordHash != null`)

### PasswordReset
Tabela para códigos temporários do reset:
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

Se for criar/atualizar schema local (recomendado):

```bash
npx prisma migrate dev
npx prisma generate
```

> No Windows PowerShell, não use `&&` (use comandos em linhas separadas ou `;`).

---

## Scripts (referência)
- `npm run build` → `prisma generate && nest build`
- `npm run start` / `start:prod` → `node dist/src/main.js`
- `npm run start:dev` → `nest start --watch`
- `npx prisma migrate deploy` → migrations em produção
- `npm test` / `npm run test:e2e`

---

## Endpoints

Base: local `http://localhost:3000` | prod `https://todo-nest-api-p6b1.onrender.com`

### Health
- `GET /` → `"OK"`
- `GET /db` → `{ ok: true, rows: [...] }`

---

### Auth

#### POST `/auth/register`
Body:
```json
{ "email": "teste@teste.com", "password": "123456", "name": "Opcional" }
```
Resposta:
```json
{ "ok": true, "token": "JWT_DA_API", "user": { "id":"...", "email":"...", "googleSub": null } }
```

#### POST `/auth/login`
Body:
```json
{ "email": "teste@teste.com", "password": "123456" }
```
Resposta:
```json
{ "ok": true, "token": "JWT_DA_API", "user": { "id":"...", "email":"...", "googleSub": null } }
```

> Se o usuário foi criado via Google e não definiu senha local, a API retorna erro (ex.: “This account has no local password”).

#### POST `/auth/google`
Body:
```json
{ "idToken": "GOOGLE_ID_TOKEN_AQUI" }
```
Resposta:
```json
{ "ok": true, "token": "JWT_DA_API", "user": { "id":"...", "googleSub":"...", "email":"..." } }
```

**Regras de vínculo (importante):**
- Se já existe usuário com `googleSub`, atualiza dados (email, name, picture).
- Se não existe por `googleSub`, mas existe por **email** e `googleSub` é `null` → **vincula** (preenche `googleSub`).
- Se existe por email mas já tem outro `googleSub` → erro de conflito (raro).

---

### Reset de Senha (público)

#### POST `/auth/forgot-password`
Body:
```json
{ "email": "teste@teste.com" }
```
Resposta (sempre):
```json
{ "ok": true }
```

#### POST `/auth/reset-password`
Body:
```json
{ "email": "teste@teste.com", "code": "123456", "newPassword": "novaSenha" }
```
Resposta:
```json
{ "ok": true }
```

> Contas Google não recebem código (retorna `{ok:true}` para não revelar).

---

### User (Bearer)

Header:
```http
Authorization: Bearer <JWT_DA_API>
```

#### GET `/me`
Resposta:
```json
{ "ok": true, "user": { "id":"...", "email":"...", "googleSub":"...", "name":"...", "picture":"..." } }
```

#### PATCH `/me` (name/picture)
Body:
```json
{ "name": "Novo Nome", "picture": "https://..." }
```
Resposta:
```json
{ "ok": true, "user": { ... } }
```

#### PATCH `/me/password` (somente local)
Body:
```json
{ "currentPassword": "senhaAtual", "newPassword": "novaSenha" }
```
Resposta:
```json
{ "ok": true }
```

#### PATCH `/me/email` (somente local — retorna token novo)
Body:
```json
{ "newEmail": "novo@email.com", "password": "senhaAtual" }
```
Resposta:
```json
{ "ok": true, "token": "JWT_NOVO", "user": { ... } }
```

#### DELETE `/me`
- Local: exige `{ password }`
- Google: não exige password (opcional)

Body (local):
```json
{ "password": "senhaAtual" }
```
Resposta:
```json
{ "ok": true }
```

---

### To-Dos (Bearer)

Header:
```http
Authorization: Bearer <JWT_DA_API>
```

#### GET `/todos` (paginado ✅)
Agora o endpoint suporta paginação **cursor-based** para facilitar *lazy loading* no app.

Query params:
- `take` (opcional): quantidade de itens por página (padrão **5**, mínimo **1**, máximo **50**)
- `cursor` (opcional): `id` do último item retornado na página anterior

Resposta:
```json
{
  "ok": true,
  "items": [
    { "id":"...", "title":"...", "description":null, "done":false, "createdAt":"...", "updatedAt":"..." }
  ],
  "nextCursor": "id_do_ultimo_item"
}
```

- `nextCursor` vem `null` quando não há mais itens.
- Ordenação do backend (para paginação estável): **`createdAt desc` + `id desc`**.

Exemplos:
- Primeira página:
```http
GET /todos?take=5
```

- Próxima página:
```http
GET /todos?take=5&cursor=<nextCursor>
```

#### POST `/todos`
Body:
```json
{ "title": "Minha tarefa", "description": "opcional" }
```
Resposta:
```json
{ "ok": true, "todo": { "id":"...", "title":"...", "description":null, "done":false } }
```

#### PATCH `/todos/:id`
Body:
```json
{ "title": "Novo título", "description": null, "done": true }
```
Resposta:
```json
{ "ok": true, "todo": { "id":"...", "title":"...", "done":true } }
```

#### DELETE `/todos/:id`
Resposta:
```json
{ "ok": true }
```

---

## Testes (atenção)

Seus testes (unit/e2e) ainda esperam `"Hello World!"` no `GET /`, mas a API real retorna `"OK"`.
Atualize:
- `src/app.controller.spec.ts`
- `test/app.e2e-spec.ts`

---

## Deploy no Render (checklist atualizado)

1) Serviço Node no Render (via Git)

2) **Build Command (recomendado)**:
```bash
npm install && npm run build && npx prisma migrate deploy
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
- `EMAIL_API_BASE_URL`
- `EMAIL_FROM_NAME`
- `EMAIL_API_KEY` (opcional)
- (opcional/recomendado) `DATABASE_URL_UNPOOLED` para migrations diretas, se você usar `directUrl`

---

## Troubleshooting

- **CORS**: configure `CORS_ORIGINS` com domínios exatos; o `main.ts` responde `OPTIONS 204`.
- **401 Missing Bearer token**: faltou header `Authorization`.
- **401 Invalid or expired Google ID token**: token expirou ou `GOOGLE_CLIENT_ID` não bate com `aud`.
- **500 ao registrar/logar/resetar senha**: migration do Prisma não foi aplicada no Neon (rode `prisma migrate deploy` no Render).
- **`EMAIL_API_BASE_URL is missing`**: faltou configurar a env do e-mail no Render.
- **DATABASE_URL is missing**: faltou env.

---

## Próximos passos recomendados
- Swagger `/docs` (`@nestjs/swagger`)
- DTOs + `class-validator`
- Endpoint `/health` dedicado
- Rate limit em `/auth/forgot-password` (recomendado)
- Limpeza periódica de `PasswordReset` expirados (cron/job)

---

## Licença
UNLICENSED
