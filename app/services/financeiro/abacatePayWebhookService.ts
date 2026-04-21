import { env } from "../../utils/dotenv";
import { AbacatePayService } from "./abacatePayService";

const TENANT_WEBHOOK_EVENTS = [
  "checkout.completed",
  "checkout.refunded",
  "checkout.disputed",
  "checkout.lost",
  "transparent.completed",
  "transparent.refunded",
  "transparent.disputed",
  "transparent.lost",
] as const;

function getTenantWebhookEndpoint(contaId: number) {
  return `${env.BASE_URL}/abacatepay/webhook?scope=tenant&contaId=${contaId}`;
}

export async function ensureTenantAbacatePayWebhook(args: {
  contaId: number;
  apiKey?: string | null;
  secret?: string | null;
}) {
  if (!args.apiKey || !args.secret) {
    return { ensured: false, reason: "missing-credentials" as const };
  }

  if (!env.BASE_URL.startsWith("https://")) {
    return { ensured: false, reason: "non-https-base-url" as const };
  }

  const endpoint = getTenantWebhookEndpoint(args.contaId);
  const client = new AbacatePayService(args.apiKey);
  const existing = await client.listWebhooks();

  const alreadyExists = existing.some((item) => item.endpoint === endpoint);
  if (alreadyExists) {
    return { ensured: true, reason: "already-exists" as const };
  }

  await client.createWebhook({
    name: `Gestão Fácil • Conta ${args.contaId}`,
    endpoint,
    secret: args.secret,
    events: [...TENANT_WEBHOOK_EVENTS],
  });

  return { ensured: true, reason: "created" as const };
}
