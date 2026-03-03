// src/common/filters/all-exceptions.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";

// Prisma v7: o runtime exporta erros conhecidos e de validação
import { Prisma } from "@prisma/client";

type ErrorBody = {
  ok: false;
  error: string;
  message: string;
  statusCode: number;
  path: string;
  method: string;
  timestamp: string;
  details?: any;
};

type LooseObj = Record<string, any>;

function isObject(v: unknown): v is LooseObj {
  return typeof v === "object" && v !== null;
}

function safeString(v: unknown) {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Normaliza payloads de HttpException que podem vir como:
 * - string
 * - { message: string | string[], error?: string, statusCode?: number, ... }
 * - qualquer outro objeto
 */
function normalizeHttpResponseBody(
  responseBody: unknown,
  fallbackMessage: string,
): LooseObj {
  if (typeof responseBody === "string") {
    return { message: responseBody };
  }

  if (isObject(responseBody)) {
    const msg = responseBody.message;

    // Nest/ValidationPipe muitas vezes manda { message: string[] }
    if (Array.isArray(msg) && msg.length) {
      return { ...responseBody, message: String(msg[0]) };
    }

    if (typeof msg === "string" && msg.trim()) {
      return { ...responseBody, message: msg };
    }

    return { ...responseBody, message: fallbackMessage };
  }

  return { message: fallbackMessage };
}

function mapPrismaToHttp(err: unknown): {
  status: number;
  code: string;
  message: string;
  details?: any;
} | null {
  // Unique constraint / Not found / etc
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = (err.meta as any)?.target;
      const fields = Array.isArray(target) ? target.join(", ") : target;
      return {
        status: HttpStatus.CONFLICT,
        code: "PRISMA_UNIQUE_CONSTRAINT",
        message: fields
          ? `Unique constraint failed on: ${fields}`
          : "Unique constraint failed",
        details: { prisma: { code: err.code, meta: err.meta } },
      };
    }

    if (err.code === "P2025") {
      return {
        status: HttpStatus.NOT_FOUND,
        code: "PRISMA_NOT_FOUND",
        message: "Record not found",
        details: { prisma: { code: err.code, meta: err.meta } },
      };
    }

    return {
      status: HttpStatus.BAD_REQUEST,
      code: `PRISMA_${err.code}`,
      message: "Database request error",
      details: { prisma: { code: err.code, meta: err.meta } },
    };
  }

  // Prisma "validation"
  if (err instanceof Prisma.PrismaClientValidationError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: "PRISMA_VALIDATION_ERROR",
      message: "Database validation error",
      details: { prisma: { name: err.name, message: err.message } },
    };
  }

  // Prisma init (db down, dns, etc.)
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: "PRISMA_INIT_ERROR",
      message: "Database unavailable",
      details: { prisma: { name: err.name } },
    };
  }

  // Prisma "panic"
  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "PRISMA_PANIC",
      message: "Database panic error",
    };
  }

  return null;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const timestamp = new Date().toISOString();
    const path = req?.originalUrl || req?.url || "";
    const method = (req?.method || "").toUpperCase();

    // 1) Prisma
    const prismaMapped = mapPrismaToHttp(exception);
    if (prismaMapped) {
      const body: ErrorBody = {
        ok: false,
        error: prismaMapped.code,
        message: prismaMapped.message,
        statusCode: prismaMapped.status,
        path,
        method,
        timestamp,
        ...(prismaMapped.details ? { details: prismaMapped.details } : {}),
      };

      // eslint-disable-next-line no-console
      console.error("❌ Prisma error:", {
        error: body.error,
        statusCode: body.statusCode,
        path,
        method,
        details: body.details,
      });

      return res.status(prismaMapped.status).json(body);
    }

    // 2) HttpException (BadRequest/Unauthorized/UnprocessableEntity/etc)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const rawBody = exception.getResponse();
      const normalized = normalizeHttpResponseBody(
        rawBody,
        exception.message || "Request error",
      );

      const hasOkFalse = normalized.ok === false;
      const hasErrorString = typeof normalized.error === "string";
      const hasMessageString = typeof normalized.message === "string";
      const hasStatusCodeNumber = typeof normalized.statusCode === "number";
      const hasDetails = typeof normalized.details !== "undefined";

      // Se já veio no seu padrão { ok:false, error, message }, respeita.
      const isAlreadyStandard = hasOkFalse && hasErrorString;

      const errorCode = hasErrorString ? normalized.error : `HTTP_${status}`;
      const message = hasMessageString
        ? normalized.message
        : exception.message || "Request error";

      // ✅ detalhes "limpos" (sem duplicar ok/error/message/statusCode)
      const detailsClean =
        hasDetails
          ? normalized.details
          : typeof normalized.fields !== "undefined"
            ? { fields: normalized.fields }
            : (normalized.constraints ||
                normalized.field ||
                normalized.errors)
              ? {
                  ...(normalized.constraints
                    ? { constraints: normalized.constraints }
                    : {}),
                  ...(normalized.field ? { field: normalized.field } : {}),
                  ...(normalized.errors ? { errors: normalized.errors } : {}),
                }
              : undefined;

      const body: ErrorBody = isAlreadyStandard
        ? {
            ok: false,
            error: String(normalized.error),
            message: String(normalized.message ?? message),
            statusCode: hasStatusCodeNumber ? normalized.statusCode : status,
            path,
            method,
            timestamp,
            ...(typeof detailsClean !== "undefined" ? { details: detailsClean } : {}),
          }
        : {
            ok: false,
            error: errorCode,
            message,
            statusCode: status,
            path,
            method,
            timestamp,
            // ✅ antes era "details: normalized" (sujo). Agora: details limpos.
            ...(typeof detailsClean !== "undefined" ? { details: detailsClean } : {}),
          };

      // ✅ não poluir logs com 404 (muito comum em produção)
      if (status >= 500) {
        // eslint-disable-next-line no-console
        console.error("❌ HTTP 5xx:", {
          error: body.error,
          statusCode: body.statusCode,
          path,
          method,
        });
      } else if (status !== 404) {
        // eslint-disable-next-line no-console
        console.error("❌ HTTP error:", {
          error: body.error,
          statusCode: body.statusCode,
          path,
          method,
        });
      }

      return res.status(status).json(body);
    }

    // 3) Erro genérico
    const status = HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ErrorBody = {
      ok: false,
      error: "INTERNAL_ERROR",
      message: "Unexpected error",
      statusCode: status,
      path,
      method,
      timestamp,
    };

    // eslint-disable-next-line no-console
    console.error("🔥 Unhandled error:", {
      path,
      method,
      exception: safeString(exception),
    });

    return res.status(status).json(body);
  }
}