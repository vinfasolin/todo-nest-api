// src/common/filters/prisma-exception.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

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

function normalizePath(req?: Request) {
  return req?.originalUrl || req?.url || "";
}

@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const timestamp = new Date().toISOString();
    const path = normalizePath(req);
    const method = (req?.method || "").toUpperCase();

    // defaults
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = "PRISMA_ERROR";
    let message = "Database error";
    let details: any | undefined;

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // https://www.prisma.io/docs/orm/reference/error-reference
      const code = exception.code;

      if (code === "P2002") {
        status = HttpStatus.CONFLICT;
        error = "PRISMA_UNIQUE_CONSTRAINT";
        const target = (exception.meta as any)?.target;
        const fields = Array.isArray(target) ? target.join(", ") : target;
        message = fields
          ? `Unique constraint failed on: ${fields}`
          : "Unique constraint failed";
        details = { prisma: { code, meta: exception.meta } };
      } else if (code === "P2025") {
        status = HttpStatus.NOT_FOUND;
        error = "PRISMA_NOT_FOUND";
        message = "Record not found";
        details = { prisma: { code, meta: exception.meta } };
      } else if (code === "P2003") {
        status = HttpStatus.CONFLICT;
        error = "PRISMA_FOREIGN_KEY_CONSTRAINT";
        const field = (exception.meta as any)?.field_name;
        message = field
          ? `Foreign key constraint failed on field: ${field}`
          : "Foreign key constraint failed";
        details = { prisma: { code, meta: exception.meta } };
      } else {
        status = HttpStatus.BAD_REQUEST;
        error = `PRISMA_${code}`;
        message = "Database request error";
        details = { prisma: { code, meta: exception.meta } };
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      error = "PRISMA_VALIDATION_ERROR";
      message = "Database validation error";
      details = { prisma: { name: exception.name, message: exception.message } };
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      error = "PRISMA_INIT_ERROR";
      message = "Database unavailable";
      details = { prisma: { name: exception.name } };
    } else if (exception instanceof Prisma.PrismaClientRustPanicError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      error = "PRISMA_PANIC";
      message = "Database panic error";
    } else {
      // não deveria cair aqui por causa do @Catch, mas deixo seguro
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      error = "PRISMA_ERROR";
      message = "Database error";
    }

    const body: ErrorBody = {
      ok: false,
      error,
      message,
      statusCode: status,
      path,
      method,
      timestamp,
      ...(typeof details !== "undefined" ? { details } : {}),
    };

    // eslint-disable-next-line no-console
    console.error("❌ PrismaExceptionFilter:", {
      error: body.error,
      statusCode: body.statusCode,
      path,
      method,
      details: body.details,
    });

    return res.status(status).json(body);
  }
}