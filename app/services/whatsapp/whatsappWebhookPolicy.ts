import crypto from "node:crypto";
import type { WhatsAppWebhookKind } from "./whatsappService";

function serialize(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

export function resolveWebhookIdentity(explicitKind: WhatsAppWebhookKind, payload: any) {
  const eventId = String(
    payload?.eventId ||
    payload?.id ||
    payload?.data?.id ||
    payload?.messageId ||
    payload?.data?.messageId ||
    crypto.createHash("sha256").update(serialize(payload)).digest("hex"),
  );
  const tipo = String(explicitKind || payload?.event || payload?.type || payload?.eventName || "generic");
  return { eventId, tipo };
}

const RETRY_DELAYS_MS = [
  5_000,
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  8 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

export function webhookRetryDelayMs(attempt: number) {
  const index = Math.min(Math.max(Math.trunc(attempt) - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

export function shouldIgnoreUnmatchedDelivery(attempt: number) {
  return Math.trunc(attempt) >= 3;
}
