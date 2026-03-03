# docs/ARCHITECTURE.md — todo-nest-api

Arquitetura interna do **todo-nest-api** (NestJS 11 + Prisma v7 + Neon Postgres) com **Auth Google + Local**, **Reset de Senha**, **Swagger/OpenAPI**, **paginação cursor-based com cursor composto**, **busca/filtros server-side**, **bulk delete**, **rate limiting**, **hardening**, **filtro global de exceções** e **testes unit + e2e**.

- **Produção:** `https://todo-nest-api-p6b1.onrender.com`
- **Local:** `http://localhost:3000`
- **Swagger UI:** `/docs`
- **OpenAPI JSON:** `/openapi.json`

> Este documento descreve **como o backend funciona por dentro** (módulos, fluxo de requisição, persistência, decisões de design e pontos de atenção).  
> Para guia de uso (instalação, env vars e endpoints), veja o `README.md`.

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Camadas e fluxo de requisição](#2-camadas-e-fluxo-de-requisição)
3. [Mapa de módulos](#3-mapa-de-módulos)
4. [Bootstrap e hardening](#4-bootstrap-e-hardening-srcmaints)
5. [Swagger e OpenAPI](#5-swagger-e-openapi-srcmaints)
6. [CORS manual](#6-cors-manual-srcmaints)
7. [Rate limiting e SkipThrottle](#7-rate-limiting-e-skipthrottle)
8. [Tratamento global de erros](#8-tratamento-global-de-erros-allexceptionsfilter)
9. [Autenticação e autorização](#9-autenticação-e-autorização)
10. [Reset de senha + envio de e-mail](#10-reset-de-senha--envio-de-e-mail)
11. [Prisma v7 + pg Pool + adapter-pg](#11-prisma-v7--pg-pool--adapter-pg-prismaservice)
12. [To-Dos: paginação, busca, filtros e totais](#12-to-dos-paginação-busca-filtros-e-totais)
13. [Testes unit e e2e](#13-testes-unit-e-e2e)
14. [Deploy no Render e migrações](#14-deploy-no-render-e-migrações)
15. [Pontos de atenção](#15-pontos-de-atenção)
16. [Próximos passos recomendados](#16-próximos-passos-recomendados)

---

## 1) Visão geral

O backend foi desenhado para:

- **Autenticação híbrida:** Google (ID Token) e Local (email/senha), gerando um **JWT próprio** da API (Bearer).
- **Conta Google vs Local:** regras claras (Google não altera email/senha nem reseta senha).
- **Reset de senha seguro:** com tabela dedicada (`PasswordReset`), código com hash e expiração.
- **API amigável para mobile:** paginação **cursor-based** estável, busca/filtro server-side e **totais**.
- **Padronização de erros:** payload único e consistente para o app.
- **Operação e DX:** Swagger/OpenAPI, hardening básico, e testes unit/e2e.

---

## 2) Camadas e fluxo de requisição

### 2.1 Camadas (alto nível)

```
HTTP (Controllers)
   ↓ valida/normaliza (DTOs + ValidationPipe + pipes auxiliares)
Services (Auth/Users/Todos/PasswordReset)
   ↓ persistência
Prisma v7 (adapter-pg + pg Pool singleton)
   ↓
Neon Postgres
```

- **Controllers**: entrada HTTP, DTOs, normalização de query/body, retorno tipado (DTOs de resposta para Swagger).
- **Services**: regras de negócio (vínculo Google/local, ownership de To-Dos, paginação e totais, reset de senha).
- **PrismaService**: acesso ao banco com **Pool singleton** + SSL controlado, usando `@prisma/adapter-pg`.
- **Infra transversal**: throttling, CORS, Swagger, filtro global de exceções.

### 2.2 Fluxo típico de uma rota protegida

1) Request chega no Nest  
2) **Guards**
   - `ThrottlerSkipGuard` (global): rate limit, respeita `@SkipThrottle()`
   - `JwtAuthGuard` (por módulo/rota): valida Bearer token e preenche `req.user`
3) **ValidationPipe**: valida `@Body()` / `@Query()` / `@Param()` via DTOs (retorna **422** com payload padronizado)
4) Controller chama Service
5) Service usa Prisma para persistência
6) Resposta normal em JSON
7) Erros capturados por `AllExceptionsFilter` e convertidos em payload padrão

---

## 3) Mapa de módulos

### 3.1 AppModule

- Importa:
  - `RateLimitModule`
  - `PrismaModule`
  - `AuthModule`
  - `UsersModule`
  - `TodosModule`
- Registra `ThrottlerSkipGuard` como **guard global** via `APP_GUARD`

### 3.2 PrismaModule (`@Global()`)

- Expõe `PrismaService`

### 3.3 RateLimitModule (`@Global()`)

- Configura `ThrottlerModule.forRoot({ throttlers: [...] })`
- Expõe tokens estáveis usados pelo guard:
  - `APP_THROTTLER_OPTIONS`
  - `APP_THROTTLER_STORAGE`
- Exporta `ThrottlerModule` + tokens acima

### 3.4 AuthModule (rotas públicas)

Rotas:
- `POST /auth/google` (Google ID Token → JWT da API)
- `POST /auth/register` (Email/Senha → JWT da API)
- `POST /auth/login` (Email/Senha → JWT da API)
- `POST /auth/forgot-password` (público; anti-enumeração; **somente conta local**)
- `POST /auth/reset-password` (público; **somente conta local**)

Providers:
- `GoogleIdTokenVerifier`
- `PasswordResetService`
- `JwtModule`
- `MailModule` (indireto via `PasswordResetService` → `MailService`)

Observação:
- Rotas públicas são alvos típicos para rate limit **mais restritivo** (e o projeto já permite isso por controller/rota).

### 3.5 MailModule

- `MailService`: integra com API externa (PHP/PHPMailer) para envio de e-mails no fluxo de reset de senha.

### 3.6 UsersModule (protegido)

Guard:
- `JwtAuthGuard`

Rotas:
- `GET /me`
- `PATCH /me`
- `PATCH /me/email` (somente conta local; retorna token novo)
- `PATCH /me/password` (somente conta local)
- `DELETE /me` (conta local exige `password`)

### 3.7 TodosModule (protegido)

Guard:
- `JwtAuthGuard`

Rotas:
- `GET /todos` (cursor + busca/filtros + totais)
- `GET /todos/:id`
- `POST /todos`
- `PATCH /todos/:id`
- `DELETE /todos/:id`
- `DELETE /todos/bulk` (bulk delete por filtro/busca)
- `DELETE /todos` (removeAll sem filtro)

---

## 4) Bootstrap e hardening (src/main.ts)

### 4.1 Hardening

- `helmet()` (com ajustes em `crossOriginResourcePolicy`)
- `compression()`

> Estes middlewares são simples e ajudam em produção; podem ser refinados conforme necessidade (ex.: CSP, logging estruturado, etc).

### 4.2 ValidationPipe global

Configuração típica adotada:

- `whitelist: true`
- `forbidNonWhitelisted: true`
- `transform: true` (com `enableImplicitConversion`)
- `stopAtFirstError: true`
- `exceptionFactory(...)` retornando payload padronizado:

```json
{
  "ok": false,
  "error": "VALIDATION_ERROR",
  "message": "Validation error",
  "fields": {
    "title": ["title must be longer than or equal to 1 characters"]
  }
}
```

---

## 5) Swagger e OpenAPI (src/main.ts)

- Swagger UI: `GET /docs`
- OpenAPI JSON: `GET /openapi.json`

Boas práticas usadas/esperadas:
- `persistAuthorization: true` na UI (facilita testar Bearer token)
- `operationIdFactory` para operationIds previsíveis
- `addServer(...)` com base URL local e produção

> Dica Render: `RENDER_EXTERNAL_URL` ajuda a Swagger refletir a URL pública correta.

---

## 6) CORS manual (src/main.ts)

CORS manual foi adotado para garantir consistência e controle fino:

- Preflight **OPTIONS** sempre retorna **204**
- `Access-Control-Allow-Origin` apenas para origens permitidas
- `Vary: Origin` para evitar cache incorreto

### 6.1 Origens permitidas

- `CORS_ORIGINS` (env, separado por vírgula) **ou**
- fallback local (dev)

A normalização remove `/` final do origin para evitar mismatch.

---

## 7) Rate limiting e SkipThrottle

### 7.1 Visão

- `RateLimitModule` configura o throttler global.
- `ThrottlerSkipGuard` é um **guard global** no `AppModule`.
- `@SkipThrottle()` seta metadata para o guard pular throttling.

Arquivos:
- `src/common/throttle/rate-limit.module.ts`
- `src/common/throttle/throttler-skip.guard.ts`
- `src/common/throttle/skip-throttle.decorator.ts`

### 7.2 Por que existe um guard custom

Motivação: **compatibilidade entre versões** do `@nestjs/throttler`.

- tokens internos mudam entre versões
- o guard custom evita acoplamento com tokens instáveis
- foi ajustado para não depender de APIs/reflections que mudam (evitando que testes e rotas explodam com 500)

### 7.3 Throttling por rota

Além do global, rotas (especialmente públicas) podem definir limites específicos com `@Throttle(...)`.

---

## 8) Tratamento global de erros (AllExceptionsFilter)

O `AllExceptionsFilter` unifica o formato de erro do backend.

Cobre:

- `HttpException` (Nest)
- erros Prisma (KnownRequestError, ValidationError, InitError, Panic)
- fallback para erro genérico

Formato padronizado:

```json
{
  "ok": false,
  "error": "SOME_CODE",
  "message": "Human readable",
  "statusCode": 400,
  "path": "/route",
  "method": "GET",
  "timestamp": "2026-03-03T14:22:55.168Z",
  "details": { "optional": true }
}
```

Mapeamentos importantes (exemplos):
- Prisma `P2002` → **409** `PRISMA_UNIQUE_CONSTRAINT`
- Prisma `P2025` → **404** `PRISMA_NOT_FOUND`
- DTO/ValidationPipe → **422** `VALIDATION_ERROR`

---

## 9) Autenticação e autorização

### 9.1 JWT da API

A API emite um JWT próprio (Bearer) com validade padrão de **7 dias**.

Payload típico:

```json
{ "uid": "<user.id>", "sub": "<user.id>", "email": "<user.email>" }
```

> Como o JWT inclui `email`, ao alterar email (`PATCH /me/email`), o backend retorna um **token novo**.

### 9.2 Google login: `POST /auth/google`

Fluxo:

1) Recebe `{ idToken }`
2) `GoogleIdTokenVerifier.verify(idToken)` valida com `google-auth-library`
3) Extrai `sub` e `email`, normaliza email
4) Resolve usuário:
   - (A) existe por `googleSub` → atualiza dados
   - (B) existe por `email` com `googleSub` null → **vincula**
   - (C) existe por `email` com `googleSub` diferente → erro de vínculo
   - (D) não existe → cria novo
5) Emite JWT da API e retorna `{ ok:true, token, user }`

Restrições:
- conta Google não pode alterar email/senha nem resetar senha
- pode alterar name/picture

### 9.3 Registro/login local

- `POST /auth/register` cria ou “upgrade” adicionando `passwordHash`
- `POST /auth/login` valida senha (`bcrypt.compare`)
- `passwordHash` nunca é retornado

---

## 10) Reset de senha + envio de e-mail

### 10.1 Reset de senha (público)

- `POST /auth/forgot-password`
  - sempre `{ ok:true }` (anti-enumeração)
  - só dispara e-mail para contas **locais**
- `POST /auth/reset-password`
  - valida `code` comparando `sha256(code)` com `codeHash`
  - valida expiração (15 min)
  - marca `usedAt` ao consumir
  - atualiza `passwordHash`

Modelo `PasswordReset` (Prisma):
- `codeHash` (sha256)
- `expiresAt`
- `usedAt`
- `userId` (FK)

### 10.2 Envio de e-mail via API externa (PHP)

Env vars:
- `EMAIL_API_BASE_URL`
- `EMAIL_FROM_NAME`
- `EMAIL_API_KEY` (opcional)

Observação:
- o backend chama `/index.php/send` via querystring (limitação do host).

---

## 11) Prisma v7 + pg Pool + adapter-pg (PrismaService)

### 11.1 Pool singleton

- `pg.Pool` é **static** e compartilhado
- contador interno controla quantas instâncias usam o pool
- fecha o pool somente quando não há mais instâncias (bom para dev/hot reload)

### 11.2 SSL

Estratégia:

- URL claramente local (`localhost/127.0.0.1/0.0.0.0`) → sem SSL
- remoto (Neon/Render) → SSL habilitado
- `PG_SSL_REJECT_UNAUTHORIZED` controla `rejectUnauthorized`
  - `false` (compat)
  - `true` (mais seguro)

---

## 12) To-Dos: paginação, busca, filtros e totais

### 12.1 GET `/todos`

- paginação cursor-based (`take` + `cursor`)
- busca `q` em title/description (alias `search`)
- filtro `filter=all|open|done` (alias `status`)
- compat `done=true|false|1|0|yes|no` (prioridade)
- totais:
  - `totalAll`: total sem filtro
  - `totalFiltered`: total com filtro/busca
  - `total`: compat (= totalFiltered)

### 12.2 Cursor composto (recomendado)

No schema Prisma:
```prisma
@@unique([userId, createdAt, id])
@@index([userId, createdAt, id])
```

Cursor recomendado:
- `createdAtISO|id`

### 12.3 Bulk / Delete all

- `DELETE /todos/bulk` exclui por `q/filter/done`
- `DELETE /todos` exclui tudo (sem filtro)

---

## 13) Testes unit e e2e

### 13.1 Unit

```bash
npm test
```

### 13.2 E2E (end-to-end)

- usa `.env.test` com `DATABASE_URL` de banco de teste (separado)
- aplica migrations antes de rodar specs (conforme pipeline do projeto)

```bash
npm run test:e2e
```

### 13.3 `.env.test` no Windows (UTF‑16)

O setup e2e suporta:
- UTF‑8 **ou** UTF‑16LE (Notepad)
- `dotenv.parse` manual
- validação de variáveis críticas (ex.: `DATABASE_URL`)

Arquivos:
- `test/jest-e2e.json`
- `test/setup-e2e-env.ts`
- `test/app.e2e-spec.ts`

---

## 14) Deploy no Render e migrações

Build command recomendado:

```bash
npm ci && npx prisma generate && npx prisma migrate deploy && npm run build
```

Start:

```bash
npm run start:prod
```

---

## 15) Pontos de atenção

- **Nunca** comitar segredos/URLs reais.
- Em produção, **garanta** migrations aplicadas (`prisma migrate deploy`).
- Rate limiting: ajuste limites conforme uso real (ex.: rotas públicas mais restritas).
- CORS: `CORS_ORIGINS` deve refletir exatamente as origens do app/web.
- Password reset:
  - evitar logs com dados sensíveis
  - considerar job de limpeza de resets expirados (opcional)

---

## 16) Próximos passos recomendados

- **Fail-fast env**: validar env vars no boot (schema/validação com zod ou equivalente).
- **Observabilidade**: logger estruturado (pino/winston), request-id, tracing.
- **CI**: GitHub Actions rodando unit + e2e (com DB de teste).
- **Documentação Swagger mais rica**:
  - examples por endpoint
  - `ApiResponse` detalhando erros comuns (422/409/401/403)
- **Higiene de dados**:
  - job opcional para limpar `PasswordReset` expirados/usados.
