# docs/ARCHITECTURE.md — todo-nest-api
Arquitetura interna: módulos, fluxo de auth (Google + Email/Senha + Reset de Senha), CORS, persistência e pontos de atenção.

> Atualizado para incluir **paginação cursor-based com cursor composto**, **busca/filtros server-side** no `GET /todos` (lazy loading + search no app) e **bulk delete** via `DELETE /todos/bulk` (além de `DELETE /todos` para excluir tudo).

---

## Mapa de módulos

- **AppModule**: compõe `PrismaModule`, `AuthModule`, `UsersModule`, `TodosModule`
- **PrismaModule** (Global): expõe `PrismaService`
- **AuthModule**:
  - `POST /auth/google` (Google ID Token → JWT da API)
  - `POST /auth/register` (Email/Senha → JWT da API)
  - `POST /auth/login` (Email/Senha → JWT da API)
  - `POST /auth/forgot-password` (público: envia código por e-mail — somente conta local)
  - `POST /auth/reset-password` (público: valida código e define nova senha — somente conta local)
  - `GoogleIdTokenVerifier`
  - `PasswordResetService`
  - `JwtModule`
  - **depende de** `MailModule` (envio de e-mail via API externa)
- **MailModule**:
  - `MailService` (integração com API externa PHP para envio de e-mails)
- **UsersModule** (protegido por `JwtAuthGuard`):
  - `GET /me` (perfil)
  - `PATCH /me` (editar name/picture)
  - `PATCH /me/email` (somente conta local — retorna token novo)
  - `PATCH /me/password` (somente conta local)
  - `DELETE /me` (excluir conta; conta local exige password)
- **TodosModule** (protegido por `JwtAuthGuard`):
  - `GET /todos` (paginado + busca/filtros server-side; suporta aliases `status`, `search`, `limit`)
  - `POST /todos`
  - `PATCH /todos/:id`
  - `DELETE /todos/:id`
  - `DELETE /todos/bulk` (bulk delete por filtro/busca)
  - `DELETE /todos` (excluir tudo sem filtro)

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

## Auth: Google ID Token / Email+Senha → JWT da API

A API emite um **JWT próprio** (Bearer) com validade padrão de **7 dias**.

Payload emitido:
```json
{ "uid": "<user.id>", "sub": "<user.id>", "email": "<user.email>" }
```

> Como o JWT inclui `email`, quando o usuário altera o e-mail via API (`PATCH /me/email`),
> o backend devolve um **token novo**.

---

## Google Login: `POST /auth/google` (Google ID Token → JWT)

1) Controller valida `idToken`  
2) `GoogleIdTokenVerifier.verify()` valida com `google-auth-library`:
   - `aud` precisa bater com `process.env.GOOGLE_CLIENT_ID` (e/ou fallback, se existir)  
3) Extrai `sub` e `email` e normaliza o email (`trim().toLowerCase()`)  
4) Resolução de usuário (regra de vínculo):
   - **A:** existe usuário por `googleSub` → atualiza `email`, `name`, `picture`
   - **B:** não existe por `googleSub`, mas existe por `email` e `googleSub` é `null` → **vincula** preenchendo `googleSub`
   - **C:** existe por `email`, mas já tem `googleSub` diferente → conflito (erro)
   - **D:** não existe por `googleSub` nem por `email` → cria novo usuário com `googleSub`
5) Emite JWT da API (7d) e retorna `{ ok:true, token, user }`

### Restrições (Google)
- Conta Google **não pode**:
  - alterar **senha** (`PATCH /me/password`)
  - alterar **e-mail** (`PATCH /me/email`)
  - usar reset de senha (`/auth/forgot-password` não envia código)
- Conta Google **pode**:
  - alterar **name** e **picture** (`PATCH /me`)

---

## Registro local: `POST /auth/register` (Email/Senha → JWT)

1) Valida `email` e `password` (mín. 6)  
2) Busca usuário por `email`  
3) Regras:
   - Se existe e **já possui** `passwordHash` → rejeita (email já cadastrado)
   - Se existe e **não possui** `passwordHash` (conta Google-only) → “upgrade” adicionando `passwordHash`
   - Se não existe → cria novo usuário com `email`, `name?` e `passwordHash`
4) `passwordHash` é gerado com `bcrypt`  
5) Emite JWT da API e retorna `{ ok:true, token, user }`

> Importante: a API **nunca** retorna `passwordHash`.

---

## Login local: `POST /auth/login` (Email/Senha → JWT)

1) Busca usuário por `email`  
2) Se não existe → `401 Invalid credentials`  
3) Se existe mas `passwordHash` é `null` → `401 This account has no local password`  
4) Valida senha com `bcrypt.compare`  
5) Emite JWT da API e retorna `{ ok:true, token, user }` (sem `passwordHash`)

---

## Reset de senha (público): `POST /auth/forgot-password` e `POST /auth/reset-password`

### Objetivo
Permitir “Esqueci minha senha” **somente para conta local**.

### 1) Solicitar código — `POST /auth/forgot-password`
- entrada: `{ email }`
- comportamento:
  - sempre retorna `{ ok:true }` (**anti-enumeração**)
  - se usuário não existir → `{ ok:true }`
  - se usuário for Google → `{ ok:true }` (não envia e-mail)
  - se usuário for Local → cria código e envia e-mail

### 2) Confirmar e definir nova senha — `POST /auth/reset-password`
- entrada: `{ email, code, newPassword }`
- valida:
  - conta **não pode ser Google**
  - código precisa existir, estar **não usado** e **não expirado** (15 min)
- aplica:
  - atualiza `User.passwordHash`
  - marca `PasswordReset.usedAt`

### Segurança
- código é armazenado como **hash (sha256)** em `PasswordReset.codeHash`
- expiração padrão: **15 minutos**
- recomendações:
  - rate limit por IP / email em `/auth/forgot-password`
  - limpeza periódica de resets expirados (job/cron)

---

## Mail: envio de e-mail via API externa (PHP)

`MailService` integra com um endpoint externo (host PHP) que recebe parâmetros via **querystring**.

- Base: `EMAIL_API_BASE_URL` (ex.: `https://armazenamentoarquivos.com.br/api-email`)
- Endpoint: `/index.php/send?to=...&subject=...&text=...&fromName=...`
- Método: `POST` (body vazio; parâmetros na URL)
- Header opcional: `X-Api-Key` via `EMAIL_API_KEY`

Env vars:
- `EMAIL_API_BASE_URL`
- `EMAIL_FROM_NAME`
- `EMAIL_API_KEY` (opcional)

---

## Guard: `JwtAuthGuard`

- Lê `Authorization: Bearer <token>`
- `jwt.verifyAsync` com `JWT_SECRET`
- injeta em `req.user`:
```ts
{ uid: payload.uid || payload.sub, sub: payload.sub, email: payload.email }
```
Esse `uid` é usado como `userId` em `/todos` e para buscar o perfil em `/me`.

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

> Em dev/hot-reload pode haver múltiplas instâncias; é comum manter um controle para
> só encerrar o pool quando for a última instância.

---

## Modelos (schema.prisma)

### User
- `id` cuid PK
- `email` unique
- `googleSub` unique **opcional** (`String?`)
- `passwordHash` **opcional** (`String?`) para login local
- `name`, `picture` opcionais
- relação 1:N com `Todo`
- relação 1:N com `PasswordReset`

Permite:
- **Local-only**: `passwordHash != null`, `googleSub == null`
- **Google-only**: `googleSub != null`, `passwordHash == null`
- **Vinculada**: `googleSub != null`, `passwordHash != null`

### PasswordReset
- `codeHash` (sha256), `expiresAt`, `usedAt?`, FK para `User` com `onDelete: Cascade`
- índices em `[userId]` e `[expiresAt]`

### Todo
- `id` cuid PK, `title`, `description?`, `done` default false, FK `userId` com `onDelete: Cascade`
- índice em `[userId]`

#### ✅ Cursor composto (recomendado para paginação estável)
Como o backend ordena por **`createdAt desc` + `id desc`**, o cursor ideal é composto:
```
<createdAtISO>|<id>
```
Para permitir `cursor` composto no Prisma com segurança, adicione no `Todo`:

```prisma
model Todo {
  // ...
  @@unique([userId, createdAt, id]) // gera userId_createdAt_id
}
```

---

## To-Dos: paginação + busca/filtros + validações + ownership

### GET `/todos` — paginação cursor-based + busca/filtro server-side

Objetivo:
- lazy loading (carregar aos poucos)
- busca/filtro no servidor (acha itens ainda não carregados no app)

**Query params (principais):**
- `take` (opcional): itens por página (padrão **10**, min **1**, max **50**)
- `cursor` (opcional): cursor da página anterior
  - recomendado: `<createdAtISO>|<id>`
  - compat antigo: `<id>`
- `q` (opcional): termo de busca (title/description, case-insensitive)
- `filter` (opcional): `all | open | done`
- `done` (opcional, compat): `true|false|1|0|yes|no` (**tem prioridade**)

**Aliases aceitos (para compat com app):**
- `limit` → alias de `take`
- `search` → alias de `q`
- `status` → alias de `filter`

**Resposta:**
```json
{ "ok": true, "items": [ ... ], "nextCursor": "<cursorOuNull>" }
```

**Ordenação estável:**
- `createdAt desc`
- `id desc`

**Exemplos:**
```http
# primeira página
GET /todos?take=10

# próxima página (cursor composto)
GET /todos?take=10&cursor=2026-02-24T12:00:00.000Z|ckxyz...

# buscar (server-side)
GET /todos?take=10&q=mercado

# filtrar pendentes
GET /todos?take=10&filter=open

# filtrar concluídas + buscar
GET /todos?take=10&filter=done&q=relatorio

# aliases (compat app)
GET /todos?limit=10&status=open&search=mercado
```

> Importante: `cursor` só faz sentido dentro do **mesmo conjunto de filtros**.
> Ao mudar `q/filter/done`, recomece sem cursor (pagina 1).

---

### DELETE `/todos/bulk` — bulk delete por filtro/busca (recomendado)

Apaga em massa respeitando o mesmo “conjunto de filtros” do GET.

**Query params (os mesmos do GET):**
- `q` / `search` (alias)
- `filter` / `status` (alias)
- `done` (prioridade sobre filter)

**Exemplos:**
```http
# excluir tudo que estiver concluído
DELETE /todos/bulk?filter=done

# excluir por busca
DELETE /todos/bulk?q=teste

# aliases (compat app)
DELETE /todos/bulk?status=open&search=mercado
```

**Resposta:**
```json
{ "ok": true, "deleted": 42 }
```

---

### DELETE `/todos` — excluir tudo (sem filtro)

Apaga **todas** as tarefas do usuário autenticado (ignorando filtros).

**Exemplo:**
```http
DELETE /todos
```

Resposta:
```json
{ "ok": true, "deleted": 123 }
```

---

### Validações e ownership (service)
- `title` obrigatório e max 120
- `description` max 2000 (vazio → null)
- `done` precisa ser boolean
- update sem campos → 400
- update/delete checam ownership:
  - `findFirst({ where: { id, userId } })`
  - se não existir → 404

---

## Deploy e migrações (Render + Neon)

Recomendação: aplicar migrations automaticamente no deploy.

**Build Command (Render):**
```bash
npm install && npm run build && npx prisma migrate deploy
```

Env vars importantes no Render:
- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `CORS_ORIGINS`
- `EMAIL_API_BASE_URL`
- `EMAIL_FROM_NAME`
- `EMAIL_API_KEY` (opcional)

---

## Ponto de atenção: duplicação no módulo Todos (resolvido ✅)

✅ Padrão recomendado:
- `todos.module.ts` apenas monta imports/controllers/providers
- `todos.controller.ts` e `todos.service.ts` separados

---

## Testes

Há desalinhamento:
- API: `GET /` retorna `"OK"`
- testes: esperavam `"Hello World!"`

Ajuste:
- `src/app.controller.spec.ts`
- `test/app.e2e-spec.ts`

---

## Evoluções recomendadas

- Swagger `/docs`
- DTO + `class-validator`
- `ConfigModule` para validar env
- `/health` dedicado + métricas
- rate limit em rotas de auth públicas
- limpeza automática de `PasswordReset` expirados (cron/job)
- opcional: “definir senha local” para contas Google (UX)
