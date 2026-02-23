# docs/ARCHITECTURE.md — todo-nest-api

Arquitetura interna: módulos, fluxo de auth (Google + Email/Senha), CORS, persistência e pontos de atenção.

---

## Mapa de módulos

- **AppModule**: compõe `PrismaModule`, `AuthModule`, `UsersModule`, `TodosModule`
- **PrismaModule** (Global): expõe `PrismaService`
- **AuthModule**:
  - `POST /auth/google` (Google ID Token → JWT da API)
  - `POST /auth/register` (Email/Senha → JWT da API)
  - `POST /auth/login` (Email/Senha → JWT da API)
  - `GoogleIdTokenVerifier`
  - `JwtModule`
- **UsersModule**: `GET /me` (protegido por `JwtAuthGuard`)
- **TodosModule**: `/todos` (protegido por `JwtAuthGuard`)

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

### 1) `POST /auth/google` (Google ID Token → JWT)

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

> Observação: `googleSub` no schema é opcional (`String?`) para permitir contas locais sem Google.

### 2) `POST /auth/register` (Email/Senha → JWT)

1) Valida `email` e `password` (mín. 6)
2) Busca usuário por `email`
3) Regras:
   - Se existe e **já possui** `passwordHash` → rejeita (email já cadastrado)
   - Se existe e **não possui** `passwordHash` (ex.: conta Google-only) → faz “upgrade” adicionando `passwordHash`
   - Se não existe → cria novo usuário com `email`, `name?` e `passwordHash`
4) `passwordHash` é gerado com `bcrypt`
5) Emite JWT da API e retorna `{ ok:true, token, user }`

> Importante: a API **nunca** retorna `passwordHash` para o cliente.

### 3) `POST /auth/login` (Email/Senha → JWT)

1) Busca usuário por `email`
2) Se não existe → `401 Invalid credentials`
3) Se existe mas `passwordHash` é `null` → `401 This account has no local password`
4) Valida senha com `bcrypt.compare`
5) Emite JWT da API e retorna `{ ok:true, token, user }` (sem `passwordHash`)

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

---

## Modelos (schema.prisma)

### User (atualizado)
- `id` cuid PK
- `email` unique
- `googleSub` unique **opcional** (`String?`)
- `passwordHash` **opcional** (`String?`) para login local
- `name`, `picture` opcionais
- relação 1:N com Todo

Essa modelagem permite:
- **Local-only**: `passwordHash != null`, `googleSub == null`
- **Google-only**: `googleSub != null`, `passwordHash == null`
- **Vinculada**: `googleSub != null`, `passwordHash != null`

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

## Deploy e migrações (Render + Neon)

Recomendação: aplicar migrations automaticamente no deploy.

- **Build Command (Render)**:
```bash
npm install && npm run build && npx prisma migrate deploy
```

Isso garante que mudanças no schema (ex.: `passwordHash`, `googleSub?`) sejam aplicadas no Neon antes do start da API.

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
- testes: esperavam `"Hello World!"`

Ajuste `src/app.controller.spec.ts` e `test/app.e2e-spec.ts`.

---

## Evoluções recomendadas

- Swagger `/docs`
- DTO + `class-validator`
- `ConfigModule` para validar env
- `/health` dedicado + métricas
- remover duplicações e padronizar estrutura
- endpoint “set password” para contas Google (opcional, UX)
