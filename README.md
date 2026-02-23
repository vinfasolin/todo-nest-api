# todo-nest-api — NestJS + Prisma v7 + Neon Postgres + Auth Google + Auth Local (Email/Senha)

API de To-Dos com autenticação via **Google ID Token** *e* via **email/senha**, e autorização via **JWT próprio da API** (Bearer).  
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

#### 2) Registro local: `POST /auth/register`
- recebe `{ email, password, name? }`
- cria usuário com `passwordHash` (bcrypt)
- se já existir usuário com mesmo email criado via Google (sem senha), faz “upgrade” adicionando senha
- retorna `token` + `user`

#### 3) Login local: `POST /auth/login`
- recebe `{ email, password }`
- valida a senha (`bcrypt.compare`)
- retorna `token` + `user` (sem vazar `passwordHash`)

### Recursos protegidos
- **Perfil**: `GET /me` (Bearer JWT da API)
- **To-Dos por usuário**: `GET/POST/PATCH/DELETE /todos` (Bearer JWT da API)

### Health / Debug
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
    auth.controller.ts   <-- google + register/login
    google.strategy.ts
    jwt.guard.ts

  users/
    users.module.ts
    users.controller.ts  <-- GET /me

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
```

> `DATABASE_URL` é obrigatória: a API falha no boot sem ela.

---

## Banco de dados (Prisma schema)

### User (atualizado)
- `googleSub` agora é **opcional** (`String?`)
- `passwordHash` é **opcional** (`String?`)

Isso permite:
- conta **Google-only**
- conta **Local-only**
- conta **vinculada** (Google + Local)

---

## Instalação e execução (local)

```bash
npm install
npx prisma generate
npm run start:dev
```

Se for criar/atualizar schema local:
```bash
npx prisma migrate dev
npx prisma generate
```

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

### Auth

#### POST `/auth/register`
```json
{ "email": "teste@teste.com", "password": "123456", "name": "Opcional" }
```
Resposta:
```json
{ "ok": true, "token": "JWT_DA_API", "user": { "id":"...", "email":"...", "googleSub": null } }
```

#### POST `/auth/login`
```json
{ "email": "teste@teste.com", "password": "123456" }
```
Resposta:
```json
{ "ok": true, "token": "JWT_DA_API", "user": { "id":"...", "email":"...", "googleSub": null } }
```

> Se o usuário foi criado via Google e não definiu senha local, a API retorna erro (ex.: “no local password”).

#### POST `/auth/google`
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
- (opcional/recomendado) `DATABASE_URL_UNPOOLED` para migrations diretas, se você usar `directUrl`

---

## Troubleshooting

- **CORS**: configure `CORS_ORIGINS` com domínios exatos; o `main.ts` responde `OPTIONS 204`.
- **401 Missing Bearer token**: faltou header `Authorization`.
- **401 Invalid or expired Google ID token**: token expirou ou `GOOGLE_CLIENT_ID` não bate com `aud`.
- **404 /auth/register**: backend em produção ainda não foi redeployado com as rotas novas.
- **500 ao registrar/logar**: migration do Prisma não foi aplicada no Neon (rode `prisma migrate deploy` no Render).
- **DATABASE_URL is missing**: faltou env.

---

## Próximos passos recomendados
- Swagger `/docs` (`@nestjs/swagger`)
- DTOs + `class-validator`
- Endpoint `/health` dedicado
- “set password” para contas Google (opcional) para UX melhor

---

## Licença
UNLICENSED
