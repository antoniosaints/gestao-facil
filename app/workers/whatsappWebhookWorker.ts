import os from "node:os";
import { prisma } from "../utils/prisma";
import { DeferredWebhookError, processClaimedWebhookEvent } from "../services/whatsapp/whatsappWebhookProcessor";
import { webhookRetryDelayMs } from "../services/whatsapp/whatsappWebhookPolicy";

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const MAX_ATTEMPTS = 10;
const CONCURRENCY = 8;
const POLL_INTERVAL_MS = 500;
const LOCK_TIMEOUT_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let running = true;
let lastHeartbeatAt = 0;
let lastCleanupAt = 0;
const activePartitions = new Set<string>();

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function heartbeat(lastProcessed = false, lastError?: string | null) {
  await prisma.whatsAppWebhookWorkerEstado.upsert({
    where: { id: 1 },
    update: {
      workerId: WORKER_ID,
      heartbeatAt: new Date(),
      ...(lastProcessed ? { ultimoProcessadoEm: new Date() } : {}),
      ...(lastError !== undefined ? { ultimoErro: lastError } : {}),
    },
    create: {
      id: 1,
      workerId: WORKER_ID,
      heartbeatAt: new Date(),
      ultimoProcessadoEm: lastProcessed ? new Date() : null,
      ultimoErro: lastError || null,
    },
  });
  lastHeartbeatAt = Date.now();
}

async function recoverStaleLocks() {
  const recovered = await prisma.whatsAppWebhookEvento.updateMany({
    where: {
      status: "PROCESSANDO",
      bloqueadoEm: { lt: new Date(Date.now() - LOCK_TIMEOUT_MS) },
    },
    data: {
      status: "PENDENTE",
      workerId: null,
      bloqueadoEm: null,
      proximaTentativaEm: new Date(),
      erro: "Lock expirado; evento recuperado automaticamente",
    },
  });
  if (recovered.count) {
    console.warn(JSON.stringify({ event: "whatsapp-webhook-locks-recovered", count: recovered.count }));
  }
}

async function cleanupOldEvents() {
  const now = Date.now();
  const [processed, failed] = await prisma.$transaction([
    prisma.whatsAppWebhookEvento.deleteMany({
      where: {
        status: { in: ["PROCESSADO", "IGNORADO"] },
        processedAt: { lt: new Date(now - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.whatsAppWebhookEvento.deleteMany({
      where: {
        status: "FALHOU",
        updatedAt: { lt: new Date(now - 90 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);
  if (processed.count || failed.count) {
    console.log(JSON.stringify({
      event: "whatsapp-webhook-retention-cleanup",
      processed: processed.count,
      failed: failed.count,
    }));
  }
  lastCleanupAt = now;
}

async function claimEvent(id: number) {
  const claimed = await prisma.whatsAppWebhookEvento.updateMany({
    where: { id, status: "PENDENTE" },
    data: {
      status: "PROCESSANDO",
      workerId: WORKER_ID,
      bloqueadoEm: new Date(),
      tentativas: { increment: 1 },
      erro: null,
    },
  });
  return claimed.count === 1;
}

async function scheduleFailure(id: number, error: unknown) {
  const current = await prisma.whatsAppWebhookEvento.findUnique({ where: { id } });
  if (!current) return;
  const message = String((error as any)?.message || error || "Falha desconhecida").slice(0, 1000);
  const terminal = current.tentativas >= MAX_ATTEMPTS;
  const delay = webhookRetryDelayMs(current.tentativas);
  await prisma.whatsAppWebhookEvento.update({
    where: { id },
    data: {
      status: terminal ? "FALHOU" : "PENDENTE",
      processado: false,
      erro: message,
      workerId: null,
      bloqueadoEm: null,
      proximaTentativaEm: terminal ? null : new Date(Date.now() + delay),
    },
  });
  console.warn(JSON.stringify({
    event: terminal ? "whatsapp-webhook-failed-terminal" : "whatsapp-webhook-retry-scheduled",
    webhookEventId: id,
    attempt: current.tentativas,
    deferred: error instanceof DeferredWebhookError,
    nextDelayMs: terminal ? null : delay,
    message,
  }));
  await heartbeat(false, terminal ? message : null);
}

async function processEvent(id: number, partitionKey: string) {
  activePartitions.add(partitionKey);
  try {
    if (!(await claimEvent(id))) return;
    await processClaimedWebhookEvent(id);
    await heartbeat(true, null);
  } catch (error) {
    await scheduleFailure(id, error);
  } finally {
    activePartitions.delete(partitionKey);
  }
}

async function loop() {
  console.log(JSON.stringify({ event: "whatsapp-webhook-worker-started", workerId: WORKER_ID, concurrency: CONCURRENCY }));
  await recoverStaleLocks();
  await heartbeat(false, null);

  while (running) {
    try {
      if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) await heartbeat();
      if (Date.now() - lastCleanupAt >= CLEANUP_INTERVAL_MS) await cleanupOldEvents();
      await recoverStaleLocks();

      const capacity = CONCURRENCY - activePartitions.size;
      if (capacity <= 0) {
        await wait(POLL_INTERVAL_MS);
        continue;
      }
      const candidates = await prisma.whatsAppWebhookEvento.findMany({
        where: {
          status: "PENDENTE",
          OR: [{ proximaTentativaEm: null }, { proximaTentativaEm: { lte: new Date() } }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: Math.max(capacity * 5, 20),
        select: { id: true, partitionKey: true },
      });
      const selected: typeof candidates = [];
      const selectedPartitions = new Set<string>();
      for (const candidate of candidates) {
        if (selected.length >= capacity) break;
        if (activePartitions.has(candidate.partitionKey) || selectedPartitions.has(candidate.partitionKey)) continue;
        selected.push(candidate);
        selectedPartitions.add(candidate.partitionKey);
      }
      if (!selected.length) {
        await wait(POLL_INTERVAL_MS);
        continue;
      }
      for (const event of selected) void processEvent(event.id, event.partitionKey);
    } catch (error: any) {
      const message = String(error?.message || error);
      console.error(JSON.stringify({ event: "whatsapp-webhook-worker-loop-failed", message }));
      await heartbeat(false, message).catch(() => undefined);
      await wait(2_000);
    }
  }
}

async function shutdown(signal: string) {
  running = false;
  console.log(JSON.stringify({ event: "whatsapp-webhook-worker-stopping", signal }));
  while (activePartitions.size) await wait(100);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void loop();
