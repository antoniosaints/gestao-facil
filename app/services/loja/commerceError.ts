import { randomUUID } from "crypto";
import type { Response } from "express";

export type CommerceErrorCode =
  | "stock_unavailable"
  | "invalid_order_transition"
  | "commerce_module_inactive"
  | "gateway_unavailable"
  | "validation_failed"
  | "rate_limited"
  | "idempotency_key_reused"
  | "unauthorized"
  | "not_found";

const statusByCode: Record<CommerceErrorCode, number> = {
  stock_unavailable: 409,
  invalid_order_transition: 409,
  commerce_module_inactive: 403,
  gateway_unavailable: 503,
  validation_failed: 422,
  rate_limited: 429,
  idempotency_key_reused: 409,
  unauthorized: 401,
  not_found: 404,
};

export class CommerceError extends Error {
  readonly status: number;

  constructor(
    readonly code: CommerceErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CommerceError";
    this.status = statusByCode[code];
  }
}

export function sendCommerceError(res: Response, error: unknown) {
  const requestId = randomUUID();
  const normalized =
    error instanceof CommerceError
      ? error
      : new CommerceError("validation_failed", error instanceof Error ? error.message : "Erro inesperado");

  return res.status(normalized.status).json({
    status: normalized.status,
    message: normalized.message,
    data: null,
    error: {
      code: normalized.code,
      details: normalized.details ?? null,
      requestId,
    },
  });
}
