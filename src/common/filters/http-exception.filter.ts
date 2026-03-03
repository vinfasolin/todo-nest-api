// src/common/filters/http-exception.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";

type LooseObj = Record<string, any>;

function isObject(v: unknown): v is LooseObj {
  return typeof v === "object" && v !== null;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status = exception.getStatus?.() ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const responseBody = exception.getResponse?.();

    // O Nest pode retornar string ou objeto
    const payload: LooseObj =
      typeof responseBody === "string"
        ? { message: responseBody }
        : isObject(responseBody)
        ? responseBody
        : { message: exception.message || "Request error" };

    const messageRaw = payload.message;

    const message =
      typeof messageRaw === "string"
        ? messageRaw
        : Array.isArray(messageRaw) && messageRaw.length
        ? String(messageRaw[0])
        : exception.message || "Request error";

    // Se já veio no seu padrão (ok:false + error), respeita o error
    const errorCode =
      payload.ok === false && typeof payload.error === "string"
        ? payload.error
        : typeof payload.error === "string"
        ? payload.error
        : `HTTP_${status}`;

    return res.status(status).json({
      ok: false,
      error: errorCode,
      message,
      statusCode:
        typeof payload.statusCode === "number" ? payload.statusCode : status,
      path: req?.originalUrl || req?.url || "",
      method: (req?.method || "").toUpperCase(),
      timestamp: new Date().toISOString(),
      ...(typeof payload.details !== "undefined" ? { details: payload.details } : {}),
    });
  }
}