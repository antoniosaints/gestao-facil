import os from "node:os";
import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { redisConnecion } from "../../utils/redis";
import { ResponseHandler } from "../../utils/response";
import { pushNotificationQueue } from "../../queues/pushNotificationQueue";
import { whatsappNotificationQueue } from "../../queues/whatsappNotificationQueue";
import { emailScheduleQueue } from "../../queues/emailScheduleQueue";
import { assertSuperAdmin } from "./assinantes";

async function measure<T>(fn: () => Promise<T>) {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start, error: null as string | null };
  } catch (error: any) {
    return { ok: false, latencyMs: Date.now() - start, error: String(error?.message || error) };
  }
}

async function getQueueCounts(name: string, queue: { getJobCounts: (...args: string[]) => Promise<Record<string, number>> }) {
  try {
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
    return { name, ok: true, ...counts };
  } catch (error: any) {
    return { name, ok: false, error: String(error?.message || error) };
  }
}

export const getMonitoramentoAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const isSuperAdmin = await assertSuperAdmin(customData.userId);
    if (!isSuperAdmin) {
      return res.status(403).json({
        message: "Usuário não tem permissão para visualizar esses dados.",
      });
    }

    const [database, redis, queues] = await Promise.all([
      measure(() => prisma.$queryRawUnsafe("SELECT 1")),
      measure(async () => {
        await redisConnecion.ping();
      }),
      Promise.all([
        getQueueCounts("Notificações push", pushNotificationQueue),
        getQueueCounts("Notificações WhatsApp", whatsappNotificationQueue),
        getQueueCounts("E-mails", emailScheduleQueue),
      ]),
    ]);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const processMem = process.memoryUsage();

    return ResponseHandler(res, "Monitoramento carregado", {
      geradoEm: new Date().toISOString(),
      servidor: {
        hostname: os.hostname(),
        plataforma: `${os.type()} ${os.release()} (${os.arch()})`,
        nodeVersion: process.version,
        uptimeSegundos: Math.round(os.uptime()),
        processoUptimeSegundos: Math.round(process.uptime()),
        cpus: os.cpus().length,
        loadAvg: os.loadavg().map((value) => Number(value.toFixed(2))),
        memoriaTotalMb: Math.round(totalMem / 1024 / 1024),
        memoriaLivreMb: Math.round(freeMem / 1024 / 1024),
        memoriaUsoPercent: Number((((totalMem - freeMem) / totalMem) * 100).toFixed(1)),
        processoRssMb: Math.round(processMem.rss / 1024 / 1024),
        processoHeapMb: Math.round(processMem.heapUsed / 1024 / 1024),
      },
      banco: database,
      redis: {
        ...redis,
        status: redisConnecion.status,
      },
      filas: queues,
    });
  } catch (error) {
    handleError(res, error);
  }
};
