# todo-nest-api (NestJS + Prisma + Neon Postgres + Google Auth)

API de To-Do (tarefas) com autenticação via **Google ID Token** e autorização via **JWT próprio** da API.  
Deploy em **Render** e banco em **Neon Postgres** com **Prisma v7**.

---

## 1) O que este sistema faz

### Funcionalidades principais

- ✅ **Login com Google** (`POST /auth/google`)
  - Você envia um **Google ID Token** (JWT do Google).
  - A API valida o token com o Google.
  - A API cria/atualiza o usuário no banco (`User` via Prisma).
  - A API devolve um **JWT da própria API** (válido por 7 dias).

- ✅ **Perfil do usuário autenticado** (`GET /me`)
  - Retorna os dados do usuário logado (por `Authorization: Bearer <JWT_API>`).

- ✅ **CRUD de To-Dos por usuário** (`/todos`)
  - Cada To-Do pertence a um usuário.
  - Você lista/cria/edita/exclui tarefas do usuário logado.
  - Todas as rotas de `/todos` exigem **Bearer JWT da API**.

- ✅ **Health básico**
  - `GET /` retorna `"OK"` (teste rápido de “API viva”).
  - `GET /db` faz uma query simples no banco (`playingWithNeon`) para validar conexão.

---

## 2) Stack / Tecnologias

- **Node.js** (v22+ recomendado)
- **NestJS 11**
- **Prisma v7** + `@prisma/adapter-pg` (Pool do `pg`)
- **Neon Postgres**
- **Google Auth (ID Token)** usando `google-auth-library`
- **JWT** (`@nestjs/jwt`) para autenticação própria da API
- Deploy: **Render**

---

## 3) Estrutura (visão rápida)

```
src/
  app.module.ts
  app.controller.ts
  main.ts

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
    todos.module.ts   (arquivo “all-in-one”: controller + service + module)
```

> Observação: o módulo `todos` está “tudo-em-um” para simplificar.  
> Se quiser, dá para separar em `todos.controller.ts`, `todos.service.ts`, etc.

---

## 4) Modelos do Banco (Prisma)

### User
- `id` (cuid, PK)
- `googleSub` (unique)
- `email` (unique)
- `name`, `picture` (opcionais)
- timestamps

### Todo
- `id` (cuid, PK)
- `title` (obrigatório)
- `description` (opcional)
- `done` (boolean default false)
- `userId` (FK -> User.id, onDelete Cascade)
- timestamps + index por `userId`

---

## 5) Variáveis de Ambiente (.env)

Crie um arquivo `.env` na raiz do projeto:

```env
# Neon (pooler) — recomendado para produção
DATABASE_URL=postgresql://USER:SENHA@HOST-pooler.neon.tech/DB?sslmode=require

# opcional (se quiser usar “unpooled” em algo específico)
DATABASE_URL_UNPOOLED=postgresql://USER:SENHA@HOST.neon.tech/DB?sslmode=require

# JWT da SUA API (obrigatório em produção)
JWT_SECRET=uma_senha_forte_aqui

# Client ID do Google (web)
GOOGLE_CLIENT_ID=7647....apps.googleusercontent.com

# Porta (local geralmente 3000)
PORT=3000
```

### Render (produção)
No Render, configure essas env vars no serviço:
- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `PORT` (Render geralmente injeta, mas pode manter)

---

## 6) Instalação (local)

Na pasta do projeto:

```bash
npm install
```

---

## 7) Build e execução

### Desenvolvimento (recomendado)
```bash
npm run start:dev
```

### Produção (local)
1) Build:
```bash
npm run build
```

2) Start:
> Seu build atual gera `dist/src/main.js`.  
> Por isso, o start precisa apontar para o arquivo correto no dist.

Se você estiver usando o comando “start” customizado no package.json (o `node -e ...` que encontra o entry), rode:

```bash
npm run start
```

> Se você quiser padronizar pra rodar `node dist/main.js`, depois a gente ajusta o build do Nest para gerar em `dist/main.js` (e remove a gambiarra).

---

## 8) Como obter um Google ID Token (para testar)

Você criou este HTML (funciona):

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Get Google ID Token</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="https://accounts.google.com/gsi/client" async defer></script>
  </head>
  <body>
    <h3>Google Login (pegar ID Token)</h3>
    <div id="gbtn"></div>
    <pre id="out" style="white-space:pre-wrap"></pre>

    <script>
      window.onload = () => {
        google.accounts.id.initialize({
          client_id: "SEU_GOOGLE_CLIENT_ID_AQUI",
          callback: (resp) => {
            document.getElementById("out").textContent = resp.credential;
            console.log("ID TOKEN:", resp.credential);
          },
        });
        google.accounts.id.renderButton(document.getElementById("gbtn"), {
          theme: "outline",
          size: "large",
        });
      };
    </script>
  </body>
</html>
```

### Executar o HTML (recomendado via servidor local)
Na pasta onde está o arquivo:

```powershell
npx http-server . -p 5179
```

Abra:
- `http://localhost:5179/get-id-token.html`

O token aparece no `<pre>` e no console do navegador.

---

## 9) Endpoints (Documentação)

Base URL (local): `http://localhost:3000`  
Base URL (Render): `https://todo-nest-api-p6b1.onrender.com`

### 9.1) Health
**GET /**  
Resposta:
```json
"OK"
```

---

### 9.2) DB Test
**GET /db**  
Faz um `findMany` simples em `playingWithNeon` para validar conexão.

Resposta:
```json
{
  "ok": true,
  "rows": []
}
```

---

### 9.3) Auth Google (Login)
**POST /auth/google**

Body:
```json
{
  "idToken": "GOOGLE_ID_TOKEN_AQUI"
}
```

Resposta (sucesso):
```json
{
  "ok": true,
  "token": "JWT_DA_SUA_API",
  "user": {
    "id": "...",
    "googleSub": "...",
    "email": "...",
    "name": "...",
    "picture": "...",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

Erros:
- `401 Missing idToken`
- `401 Invalid or expired Google ID token`

---

### 9.4) Usuário logado
**GET /me**

Header:
```
Authorization: Bearer <JWT_DA_SUA_API>
```

Resposta:
```json
{
  "ok": true,
  "user": {
    "id": "...",
    "googleSub": "...",
    "email": "...",
    "name": "...",
    "picture": "...",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

### 9.5) To-Dos (CRUD)

> Todas exigem:
```
Authorization: Bearer <JWT_DA_SUA_API>
```

#### Listar
**GET /todos**

Resposta:
```json
{
  "ok": true,
  "items": [
    {
      "id": "...",
      "title": "...",
      "description": null,
      "done": false,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

#### Criar
**POST /todos**

Body:
```json
{
  "title": "Comprar pão",
  "description": "na padaria"
}
```

Resposta:
```json
{
  "ok": true,
  "todo": { "...": "..." }
}
```

#### Atualizar
**PATCH /todos/:id**

Body (exemplos):
```json
{ "done": true }
```

ou
```json
{ "title": "Novo título", "description": null }
```

Resposta:
```json
{
  "ok": true,
  "todo": { "...": "..." }
}
```

#### Excluir
**DELETE /todos/:id**

Resposta:
```json
{ "ok": true }
```

---

## 10) Testes via PowerShell (Windows)

### 10.1) Login (gera JWT da API)
```powershell
$googleIdToken = "COLE_AQUI_O_ID_TOKEN_DO_GOOGLE"
$body = @{ idToken = $googleIdToken } | ConvertTo-Json

$res = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/auth/google" `
  -ContentType "application/json" `
  -Body $body

$token = $res.token
$token
```

### 10.2) /me
```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:3000/me" `
  -Headers @{ Authorization = "Bearer $token" }
```

### 10.3) /todos
```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:3000/todos" `
  -Headers @{ Authorization = "Bearer $token" }
```

### 10.4) Criar To-Do
```powershell
$body = @{ title="Primeira task"; description="teste" } | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/todos" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $body
```

---

## 11) Troubleshooting (erros comuns)

### 11.1) `401 Missing Bearer token`
Você chamou `/me` ou `/todos` sem header:
```
Authorization: Bearer <JWT_DA_API>
```

### 11.2) `401 Invalid or expired Google ID token`
- Token expirou (pegar um novo no HTML)
- `GOOGLE_CLIENT_ID` não bate com o `aud` do token
- horário do Windows muito errado (pode quebrar validação)

### 11.3) `DATABASE_URL is missing`
Setar `.env` local e no Render.

### 11.4) `/db` falha
Banco offline / URL errada / rede / ssl.

---

## 12) Próximos passos recomendados

1) **Padronizar o build/start**
   - Fazer o Nest gerar `dist/main.js` (evitar `dist/src/main.js`)
   - Ajustar scripts no `package.json` para ficar padrão (dev/prod)

2) **Adicionar validação formal (DTO + class-validator)**
   - Melhorar segurança e mensagens de erro

3) **Adicionar documentação tipo OpenAPI/Swagger**
   - `@nestjs/swagger` + `/docs`

4) **CORS**
   - Se tiver front web consumindo, habilitar CORS no `main.ts`.

---

## Licença
UNLICENSED (projeto privado / pessoal)
