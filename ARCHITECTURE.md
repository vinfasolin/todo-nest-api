# docs/ARCHITECTURE.md — todo-nest-api

Arquitetura interna: módulos, fluxo de auth (Google + Email/Senha + Reset de Senha), CORS, persistência e pontos de atenção.

> Atualizado para incluir paginação cursor-based no `GET /todos` (lazy loading no app).

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
  - `GET/POST/PATCH/DELETE /todos`

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

> Observação: como o JWT inclui `email`, quando o usuário altera o e-mail via API
> (`PATCH /me/email`), o backend devolve um **token novo**.

---

## Google Login: `POST /auth/google` (Google ID Token → JWT)

1) Controller valida `idToken`  
2) `GoogleIdTokenVerifier.verify()` valida com `google-auth-library`:
   - audiences = `[process.env.GOOGLE_CLIENT_ID, FALLBACK_CLIENT_ID]` (sem duplicatas)
3) Extrai `sub` e `email` do payload do Google e normaliza o email (`trim().toLowerCase()`)  
4) Resolução de usuário (regra de vínculo):
   - **Caso A:** existe usuário por `googleSub` → atualiza `email`, `name`, `picture`
   - **Caso B:** não existe por `googleSub`, mas existe por `email` e `googleSub` é `null` → **vincula** preenchendo `googleSub` (a conta local vira também Google)
   - **Caso C:** existe por `email`, mas já tem `googleSub` diferente → conflito (retorna erro)
   - **Caso D:** não existe por `googleSub` nem por `email` → cria novo usuário com `googleSub`
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
   - Se existe e **não possui** `passwordHash` (ex.: conta Google-only) → faz “upgrade” adicionando `passwordHash`
   - Se não existe → cria novo usuário com `email`, `name?` e `passwordHash`
4) `passwordHash` é gerado com `bcrypt`  
5) Emite JWT da API e retorna `{ ok:true, token, user }`

> Importante: a API **nunca** retorna `passwordHash` para o cliente.

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

> Nota: em ambiente dev/hot-reload pode haver múltiplas instâncias; é comum
> usar um controle (contador) para só encerrar o pool quando for a última.

---

## Modelos (schema.prisma)

### User
- `id` cuid PK
- `email` unique
- `googleSub` unique **opcional** (`String?`)
- `passwordHash` **opcional** (`String?`) para login local
- `name`, `picture` opcionais
- relação 1:N com Todo
- relação 1:N com PasswordReset

Essa modelagem permite:
- **Local-only**: `passwordHash != null`, `googleSub == null`
- **Google-only**: `googleSub != null`, `passwordHash == null`
- **Vinculada**: `googleSub != null`, `passwordHash != null`

### PasswordReset
- `id` cuid PK
- `userId` FK → User (onDelete Cascade)
- `codeHash` sha256 do código
- `expiresAt` (timestamp)
- `usedAt` (nullable)
- índices em `[userId]` e `[expiresAt]`

### Todo
- `id` cuid PK
- `title` obrigatório
- `description` opcional
- `done` default false
- `userId` FK → User (onDelete Cascade)
- index `[userId]`

---

## To-Dos: paginação + validações + ownership

### Paginação (GET `/todos`)
O endpoint suporta paginação **cursor-based** para habilitar *lazy loading* no app.

- Query params:
  - `take` (opcional): itens por página (padrão **5**, min **1**, max **50**)
  - `cursor` (opcional): `id` do último item retornado na página anterior
- Resposta:
  - `items`: lista da página
  - `nextCursor`: `id` do último item (ou `null` quando acabou)

Ordenação do backend (estável):
- `createdAt desc`
- `id desc`

Exemplos:
```http
GET /todos?take=5
GET /todos?take=5&cursor=<nextCursor>
```

### Validações e ownership
No service:
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

- **Build Command (Render)**:
```bash
npm install && npm run build && npx prisma migrate deploy
```

Isso garante que mudanças no schema (ex.: `passwordHash`, `googleSub?`, `PasswordReset`) sejam aplicadas no Neon antes do start da API.

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

Antes você tinha:
- arquivos separados (`todos.controller.ts` + `todos.service.ts`)
- e uma versão “all-in-one” dentro de `todos.module.ts` (service+controller internos)

✅ Agora o padrão recomendado é **somente** a versão separada (controller/service/module).

---

## Testes

Há desalinhamento:
- API: `GET /` retorna `"OK"`
- testes: esperavam `"Hello World!"`

Ajuste `src/app.controller.spec.ts` e `test/app.e2e-spec.ts`.

---

## Evoluções recomendadas

- Swagger `/docs`
- DTO + `class-validator`
- `ConfigModule` para validar env
- `/health` dedicado + métricas
- padronizar estrutura
- rate limit em rotas de auth públicas
- limpeza automática de `PasswordReset` expirados (cron/job)
- endpoint “set password” para contas Google (opcional, UX)
