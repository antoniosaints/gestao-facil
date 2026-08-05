import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { sendRestaurantUpdate } from "../../hooks/restaurante/socket";
import { contaHasActiveModule } from "../../services/contas/storeModulesService";
import {
  acknowledgeStationPrintJob,
  claimStationPrintJobs,
  enqueueTicketPrintJobs,
  hashPrintStationToken,
} from "../../services/restaurante/printing";
import { prisma } from "../../utils/prisma";

const stationSchema = z.object({
  nome: z.string().trim().min(2).max(100),
  ativa: z.boolean().default(true),
  version: z.coerce.number().int().positive().optional(),
});

const printDestinationSchema = z.object({
  estacaoId: z.coerce.number().int().positive(),
  fallbackEstacaoId: z.coerce.number().int().positive().nullable().optional(),
  papel: z.enum(["58mm", "80mm"]).default("80mm"),
  vias: z.coerce.number().int().min(1).max(5).default(1),
  imprimirPedidoCompleto: z.boolean().default(false),
});

const ruleSchema = printDestinationSchema.extend({
  pontoId: z.coerce.number().int().positive(),
  destinosAdicionais: z.array(printDestinationSchema).max(20).default([]),
  ativa: z.boolean().default(true),
  version: z.coerce.number().int().positive().optional(),
});

const heartbeatSchema = z.object({
  impressoraNome: z.string().trim().min(1).max(255),
  papel: z.enum(["58mm", "80mm"]).default("80mm"),
});

const ackSchema = z.object({
  uid: z.string().uuid(),
  leaseToken: z.string().uuid(),
  success: z.boolean(),
  error: z.string().trim().max(2000).nullable().optional(),
});

function requestId(req: Request) {
  return String(req.headers["x-request-id"] || randomUUID());
}

function ok(req: Request, res: Response, data: unknown, status = 200) {
  return res.status(status).json({ data, requestId: requestId(req) });
}

function fail(req: Request, res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: requestId(req) } });
}

async function resolveStation(req: Request) {
  const token = req.header("X-Print-Station-Token")?.trim();
  if (!token || token.length < 32) return null;
  const station = await prisma.restauranteEstacaoImpressao.findUnique({ where: { tokenHash: hashPrintStationToken(token) } });
  if (!station?.ativa || !(await contaHasActiveModule(station.contaId, "restaurante-delivery"))) return null;
  return station;
}

export async function listPrintStations(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const stations = await prisma.restauranteEstacaoImpressao.findMany({
    where: { contaId },
    orderBy: [{ ativa: "desc" }, { nome: "asc" }],
    include: {
      _count: { select: { regrasPrimarias: true, trabalhos: true } },
    },
  });
  const onlineLimit = Date.now() - 30_000;
  return ok(req, res, stations.map(({ tokenHash: _tokenHash, ...station }) => ({
    ...station,
    online: Boolean(station.online && station.lastSeenAt && station.lastSeenAt.getTime() >= onlineLimit),
  })));
}

export async function savePrintStation(req: Request, res: Response) {
  const parsed = stationSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Dados invalidos.", parsed.error.flatten());
  const { contaId } = getCustomRequest(req).customData;
  const id = Number(req.params.id || 0);
  const current = id ? await prisma.restauranteEstacaoImpressao.findFirst({ where: { id, contaId } }) : null;
  if (id && !current) return fail(req, res, 404, "print_station_not_found", "Estacao nao encontrada.");
  if (current && parsed.data.version && current.version !== parsed.data.version) {
    return fail(req, res, 409, "version_conflict", "A estacao foi alterada em outra sessao.");
  }
  const { version: _version, ...data } = parsed.data;
  try {
    if (current) {
      const saved = await prisma.restauranteEstacaoImpressao.update({
        where: { id: current.id }, data: { ...data, version: { increment: 1 } },
      });
      const { tokenHash: _tokenHash, ...response } = saved;
      return ok(req, res, response);
    }
    const token = randomBytes(32).toString("base64url");
    const saved = await prisma.restauranteEstacaoImpressao.create({
      data: { ...data, contaId, tokenHash: hashPrintStationToken(token), tokenPrefix: token.slice(0, 12) },
    });
    const { tokenHash: _tokenHash, ...response } = saved;
    return ok(req, res, { ...response, pairingToken: token }, 201);
  } catch (error: any) {
    if (error?.code === "P2002") return fail(req, res, 409, "print_station_name_conflict", "Ja existe uma estacao com este nome.");
    throw error;
  }
}

export async function regeneratePrintStationToken(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const station = await prisma.restauranteEstacaoImpressao.findFirst({ where: { id: Number(req.params.id), contaId } });
  if (!station) return fail(req, res, 404, "print_station_not_found", "Estacao nao encontrada.");
  const token = randomBytes(32).toString("base64url");
  await prisma.restauranteEstacaoImpressao.update({
    where: { id: station.id },
    data: { tokenHash: hashPrintStationToken(token), tokenPrefix: token.slice(0, 12), online: false, version: { increment: 1 } },
  });
  return ok(req, res, { pairingToken: token, tokenPrefix: token.slice(0, 12) });
}

export async function listPrintRules(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  return ok(req, res, await prisma.restauranteRegraImpressao.findMany({
    where: { contaId }, orderBy: { Ponto: { ordem: "asc" } },
    include: {
      Ponto: true,
      Estacao: { select: { id: true, nome: true } },
      FallbackEstacao: { select: { id: true, nome: true } },
      destinos: {
        orderBy: { ordem: "asc" },
        include: {
          Estacao: { select: { id: true, nome: true } },
          FallbackEstacao: { select: { id: true, nome: true } },
        },
      },
    },
  }));
}

export async function savePrintRule(req: Request, res: Response) {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Dados invalidos.", parsed.error.flatten());
  const { contaId } = getCustomRequest(req).customData;
  const destinations = [{
    estacaoId: parsed.data.estacaoId,
    fallbackEstacaoId: parsed.data.fallbackEstacaoId,
  }, ...parsed.data.destinosAdicionais];
  if (destinations.some((destination) => destination.fallbackEstacaoId === destination.estacaoId)) {
    return fail(req, res, 422, "invalid_print_fallback", "A contingencia deve ser diferente da impressora de destino.");
  }
  const primaryStationIds = destinations.map((destination) => destination.estacaoId);
  if (new Set(primaryStationIds).size !== primaryStationIds.length) {
    return fail(req, res, 422, "duplicate_print_destination", "Cada impressora pode aparecer somente uma vez nas saidas simultaneas.");
  }
  if (destinations.some((destination) => destination.fallbackEstacaoId && primaryStationIds.includes(destination.fallbackEstacaoId))) {
    return fail(req, res, 422, "invalid_print_fallback", "Uma contingencia nao pode ser uma impressora que ja recebe a impressao simultaneamente.");
  }
  const stationIds = [...new Set(destinations.flatMap((destination) => [
    destination.estacaoId,
    ...(destination.fallbackEstacaoId ? [destination.fallbackEstacaoId] : []),
  ]))];
  const [point, stations] = await Promise.all([
    prisma.restaurantePontoProducao.findFirst({ where: { id: parsed.data.pontoId, contaId } }),
    prisma.restauranteEstacaoImpressao.findMany({
      where: { contaId, id: { in: stationIds } },
      select: { id: true },
    }),
  ]);
  if (!point) return fail(req, res, 404, "production_point_not_found", "Ponto de producao nao encontrado.");
  if (stations.length !== stationIds.length) return fail(req, res, 422, "invalid_print_stations", "Uma ou mais impressoras de destino ou contingencia sao invalidas.");
  const current = await prisma.restauranteRegraImpressao.findUnique({ where: { pontoId: point.id } });
  if (current && parsed.data.version && current.version !== parsed.data.version) {
    return fail(req, res, 409, "version_conflict", "A regra foi alterada em outra sessao.");
  }
  const { version: _version, destinosAdicionais, ...data } = parsed.data;
  const saved = await prisma.$transaction(async (tx) => {
    const rule = current
      ? await tx.restauranteRegraImpressao.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } })
      : await tx.restauranteRegraImpressao.create({ data: { ...data, contaId } });
    await tx.restauranteRegraImpressaoDestino.deleteMany({ where: { regraId: rule.id } });
    if (destinosAdicionais.length) {
      await tx.restauranteRegraImpressaoDestino.createMany({
        data: destinosAdicionais.map((destination, ordem) => ({ ...destination, contaId, regraId: rule.id, ordem })),
      });
    }
    return tx.restauranteRegraImpressao.findUniqueOrThrow({
      where: { id: rule.id },
      include: {
        Ponto: true,
        Estacao: { select: { id: true, nome: true } },
        FallbackEstacao: { select: { id: true, nome: true } },
        destinos: {
          orderBy: { ordem: "asc" },
          include: {
            Estacao: { select: { id: true, nome: true } },
            FallbackEstacao: { select: { id: true, nome: true } },
          },
        },
      },
    });
  });
  sendRestaurantUpdate(contaId, "impressao", { regraId: saved.id });
  return ok(req, res, saved, current ? 200 : 201);
}

export async function listPrintJobs(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const jobs = await prisma.restauranteTrabalhoImpressao.findMany({
    where: { contaId, ...(status && status !== "TODOS" ? { status: status as any } : {}) },
    orderBy: { createdAt: "desc" }, take: 100,
    include: {
      Estacao: { select: { id: true, nome: true, impressoraNome: true } },
      Ponto: { select: { id: true, nome: true } },
      Ticket: { select: { Pedido: { select: { codigo: true } } } },
    },
  });
  return ok(req, res, jobs);
}

export async function reprintProductionTicket(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const ticket = await prisma.restauranteTicketProducao.findFirst({ where: { id: Number(req.params.id), contaId } });
  if (!ticket) return fail(req, res, 404, "kds_ticket_not_found", "Ticket nao encontrado.");
  const jobs = await prisma.$transaction((tx) => enqueueTicketPrintJobs(tx, contaId, ticket.id, `reprint:${ticket.id}:${randomUUID()}`));
  if (!jobs.length) return fail(req, res, 422, "print_rule_not_configured", "Configure ao menos uma saida de impressao ativa para este ponto.");
  sendRestaurantUpdate(contaId, "impressao", { trabalhoIds: jobs.map((job) => job.id) });
  return ok(req, res, jobs, 201);
}

export async function stationHeartbeat(req: Request, res: Response) {
  const station = await resolveStation(req);
  if (!station) return fail(req, res, 401, "invalid_print_station", "Token de estacao invalido.");
  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Dados invalidos.", parsed.error.flatten());
  const updated = await prisma.restauranteEstacaoImpressao.update({
    where: { id: station.id },
    data: { impressoraNome: parsed.data.impressoraNome, papelReportado: parsed.data.papel, online: true, lastSeenAt: new Date() },
  });
  return ok(req, res, { id: updated.id, nome: updated.nome, lastSeenAt: updated.lastSeenAt });
}

export async function stationClaimJobs(req: Request, res: Response) {
  const station = await resolveStation(req);
  if (!station) return fail(req, res, 401, "invalid_print_station", "Token de estacao invalido.");
  await prisma.restauranteEstacaoImpressao.update({ where: { id: station.id }, data: { online: true, lastSeenAt: new Date() } });
  return ok(req, res, await claimStationPrintJobs(prisma, station, Number(req.query.limit) || 10));
}

export async function stationAckJob(req: Request, res: Response) {
  const station = await resolveStation(req);
  if (!station) return fail(req, res, 401, "invalid_print_station", "Token de estacao invalido.");
  const parsed = ackSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Dados invalidos.", parsed.error.flatten());
  const job = await acknowledgeStationPrintJob(prisma, station, parsed.data);
  if (!job) return fail(req, res, 409, "invalid_print_lease", "Lease expirado ou trabalho ja processado.");
  sendRestaurantUpdate(station.contaId, "impressao", { trabalhoId: job.id, status: job.status });
  return ok(req, res, { uid: job.uid, status: job.status });
}
