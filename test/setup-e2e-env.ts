// test/setup-e2e-env.ts
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

// ✅ IMPORTANTÍSSIMO: garante modo teste antes de importar AppModule em qualquer teste
process.env.NODE_ENV = "test";

const envPath = path.resolve(process.cwd(), ".env.test");

function isMostlyUtf16(buf: Buffer) {
  // Heurística: UTF-16 costuma ter muitos 0x00 intercalados
  if (buf.length < 8) return false;
  let zeroCount = 0;
  const max = Math.min(buf.length, 400);
  for (let i = 0; i < max; i++) {
    if (buf[i] === 0x00) zeroCount++;
  }
  return zeroCount > 20;
}

function decodeEnvFile(buf: Buffer): string {
  // UTF-8 BOM
  if (
    buf.length >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    return buf.slice(3).toString("utf8");
  }

  // UTF-16 LE BOM (FF FE)
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString("utf16le");
  }

  // UTF-16 BE BOM (FE FF) -> converter p/ LE
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buf.length - 2);
    for (let i = 2, j = 0; i < buf.length; i += 2, j += 2) {
      swapped[j] = buf[i + 1] ?? 0x00;
      swapped[j + 1] = buf[i] ?? 0x00;
    }
    return swapped.toString("utf16le");
  }

  // UTF-16 sem BOM (comum no Notepad do Windows)
  if (isMostlyUtf16(buf)) {
    return buf.toString("utf16le");
  }

  // padrão: UTF-8
  return buf.toString("utf8");
}

function normalizeRaw(raw: string): string {
  // remove nulls e normaliza quebras
  return raw.replace(/\u0000/g, "").replace(/\r\n/g, "\n");
}

function maskDbUrl(url: string) {
  // não vazar senha: postgres://user:pass@host/db -> postgres://user:***@host/db
  return url.replace(/\/\/([^:\/]+):([^@\/]+)@/g, "//$1:***@");
}

function safePreviewKeys(keys: string[], max = 12) {
  // não mostrar valores de segredos por engano — apenas nomes
  return keys.slice(0, max);
}

if (!fs.existsSync(envPath)) {
  // eslint-disable-next-line no-console
  console.error("❌ .env.test não encontrado em:", envPath);
  // eslint-disable-next-line no-console
  console.error("CWD do Jest:", process.cwd());
  throw new Error(".env.test não encontrado. Confirme que está na raiz do projeto.");
}

const buf = fs.readFileSync(envPath);
const decoded = decodeEnvFile(buf);
const raw = normalizeRaw(decoded);

if (!raw.trim()) {
  throw new Error(".env.test está vazio (ou só com caracteres invisíveis).");
}

// ✅ parse manual (dotenv.parse aceita string/buffer; já suporta quotes e comentários)
const parsed = dotenv.parse(raw);

// ✅ aplica no process.env (override do que vier no arquivo)
for (const [k, v] of Object.entries(parsed)) {
  process.env[k] = v;
}

// ✅ fallback útil: se você usar DATABASE_URL_TEST, preenche DATABASE_URL
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

// ✅ valida DATABASE_URL (obrigatório pros e2e)
const dbUrl = String(process.env.DATABASE_URL || "").trim();
if (!dbUrl) {
  // eslint-disable-next-line no-console
  console.error("❌ DATABASE_URL ainda vazio após parse.");
  // eslint-disable-next-line no-console
  console.error("Dica: a linha precisa ser: DATABASE_URL=postgresql://...");
  throw new Error("DATABASE_URL não está definido no .env.test");
}

// ✅ logs seguros (sem vazar secrets)
const keys = Object.keys(parsed).sort();
const dbMasked = maskDbUrl(dbUrl);

// eslint-disable-next-line no-console
console.log("✅ e2e env carregado (.env.test): DATABASE_URL ok");
// eslint-disable-next-line no-console
console.log("ℹ️ setup-e2e-env.ts:", {
  file: envPath,
  bytes: buf.length,
  keys: keys.length,
  sampleKeys: safePreviewKeys(keys, 12),
  DATABASE_URL: dbMasked,
  NODE_ENV: process.env.NODE_ENV,
});