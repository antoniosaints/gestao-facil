import type { Request, Response } from "express";
import { ReservaStatus } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import {
  reservationAvailabilitySchema,
  reservationCancelSchema,
  reservationConfigSchema,
  reservationCreateSchema,
  reservationExceptionSchema,
  reservationLinkCustomerSchema,
  reservationManualPaymentSchema,
  reservationPreviewSchema,
  reservationResourceSchema,
  reservationRescheduleSchema,
  reservationServiceConfigSchema,
} from "../../schemas/reservas";
import {
  actOnReservation,
  cancelPublicReservation,
  createInternalReservation,
  createPublicReservation,
  deleteCanceledReservation,
  deleteReservationResource,
  deleteReservationServiceConfig,
  deleteScheduleException,
  ensureReservationConfig,
  getPublicReservation,
  getPublicReservationStore,
  getPublicReservationTenant,
  getReservationsDashboard,
  getReservationAvailability,
  linkReservationCustomer,
  listScheduleExceptions,
  listReservationResources,
  listReservations,
  listReservationServiceConfigs,
  recordManualReservationPayment,
  requestReservationRefund,
  replaceResourceAvailability,
  rescheduleReservation,
  reschedulePublicReservation,
  retryPublicReservationPayment,
  saveReservationResource,
  saveReservationServiceConfig,
  saveScheduleException,
  updateReservationConfig,
} from "../../services/reservas/reservaService";
import { ResponseHandler } from "../../utils/response";

function token(req: Request) {
  const authorization = String(req.header("Authorization") || "");
  if (authorization.startsWith("Bearer ")) return authorization.slice(7);
  return String(req.header("X-Reserva-Token") || "");
}

function errorResponse(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Não foi possível concluir a operação.";
  const lower = message.toLowerCase();
  const status =
    lower.includes("não encontrad") ? 404
    : lower.includes("token") ? 401
    : lower.includes("outra sessão")
      || lower.includes("acabou de ser reservado")
      || lower.includes("possui reservas vinculadas") ? 409
    : lower.includes("módulo") || lower.includes("permiss") ? 403
    : 422;
  return res.status(status).json({
    status,
    message,
    error: {
      code: status === 409 ? "reservation_conflict" : status === 404 ? "reservation_not_found" : "reservation_invalid",
      message,
    },
  });
}

export async function adminGetConfig(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Configuração encontrada.",
      await ensureReservationConfig(getCustomRequest(req).customData.contaId),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminSaveConfig(req: Request, res: Response) {
  try {
    const body = reservationConfigSchema.parse(req.body);
    return ResponseHandler(
      res,
      "Configuração salva.",
      await updateReservationConfig(getCustomRequest(req).customData.contaId, body as any),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminListResources(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Recursos encontrados.",
      await listReservationResources(getCustomRequest(req).customData.contaId),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminResourceOptions(req: Request, res: Response) {
  try {
    const contaId = getCustomRequest(req).customData.contaId;
    const search = String(req.query.search || "").trim().toLocaleLowerCase("pt-BR");
    const selectedId = req.query.id ? Number(req.query.id) : null;
    const serviceConfigId = req.query.serviceConfigId ? Number(req.query.serviceConfigId) : null;
    let resources = (await listReservationResources(contaId))
      .map((item) => ({ id: item.id, nome: item.nome, ativo: item.ativo }));

    if (serviceConfigId) {
      const services = await listReservationServiceConfigs(contaId);
      const service = services.find((item) => item.id === serviceConfigId);
      resources = service?.Recursos.map((item) => ({
        id: item.Recurso.id,
        nome: item.Recurso.nome,
        ativo: item.Recurso.ativo,
      })) || [];
    }

    return res.json({
      results: resources
        .filter((item) => item.ativo)
        .filter((item) => !selectedId || item.id === selectedId)
        .filter((item) => !search || item.nome.toLocaleLowerCase("pt-BR").includes(search))
        .slice(0, 30)
        .map((item) => ({ id: item.id, label: item.nome })),
    });
  } catch (error) { return errorResponse(res, error); }
}

export async function adminSaveResource(req: Request, res: Response) {
  try {
    const body = reservationResourceSchema.parse({ ...req.body, id: req.params.id ? Number(req.params.id) : req.body.id });
    return ResponseHandler(
      res,
      body.id ? "Recurso atualizado." : "Recurso criado.",
      await saveReservationResource(getCustomRequest(req).customData.contaId, body),
      body.id ? 200 : 201,
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminReplaceAvailability(req: Request, res: Response) {
  try {
    const body = reservationAvailabilitySchema.parse(req.body);
    return ResponseHandler(
      res,
      "Disponibilidade atualizada.",
      await replaceResourceAvailability(
        getCustomRequest(req).customData.contaId,
        Number(req.params.id),
        body.ranges,
      ),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminSaveException(req: Request, res: Response) {
  try {
    const body = reservationExceptionSchema.parse(req.body);
    return ResponseHandler(
      res,
      body.id ? "Exceção atualizada." : "Exceção criada.",
      await saveScheduleException(getCustomRequest(req).customData.contaId, body),
      body.id ? 200 : 201,
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminListExceptions(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Exceções encontradas.",
      await listScheduleExceptions(
        getCustomRequest(req).customData.contaId,
        req.query.resourceId ? Number(req.query.resourceId) : undefined,
      ),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminDeleteException(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Exceção removida.",
      await deleteScheduleException(getCustomRequest(req).customData.contaId, Number(req.params.id)),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminDeleteResource(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Recurso excluído.",
      await deleteReservationResource(getCustomRequest(req).customData.contaId, Number(req.params.id)),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminListServices(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Serviços reserváveis encontrados.",
      await listReservationServiceConfigs(getCustomRequest(req).customData.contaId),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminServiceOptions(req: Request, res: Response) {
  try {
    const search = String(req.query.search || "").trim().toLocaleLowerCase("pt-BR");
    const selectedId = req.query.id ? Number(req.query.id) : null;
    const services = await listReservationServiceConfigs(getCustomRequest(req).customData.contaId);
    return res.json({
      results: services
        .filter((item) => item.ativo)
        .filter((item) => !selectedId || item.id === selectedId)
        .filter((item) => !search || item.Servico.nome.toLocaleLowerCase("pt-BR").includes(search))
        .slice(0, 30)
        .map((item) => ({ id: item.id, label: item.Servico.nome })),
    });
  } catch (error) { return errorResponse(res, error); }
}

export async function adminSaveService(req: Request, res: Response) {
  try {
    const body = reservationServiceConfigSchema.parse(req.body);
    return ResponseHandler(
      res,
      "Serviço reservável salvo.",
      await saveReservationServiceConfig(getCustomRequest(req).customData.contaId, body as any),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminDeleteService(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Serviço removido das reservas.",
      await deleteReservationServiceConfig(getCustomRequest(req).customData.contaId, Number(req.params.id)),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminAvailability(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Horários encontrados.",
      await getReservationAvailability({
        contaId: getCustomRequest(req).customData.contaId,
        serviceConfigId: Number(req.query.serviceConfigId),
        resourceId: req.query.resourceId ? Number(req.query.resourceId) : null,
        dateFrom: String(req.query.dateFrom),
        dateTo: String(req.query.dateTo),
      }),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminDashboard(req: Request, res: Response) {
  try {
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setDate(defaultStart.getDate() - 29);
    defaultStart.setHours(0, 0, 0, 0);

    const startAt = req.query.startAt ? new Date(String(req.query.startAt)) : defaultStart;
    const endAt = req.query.endAt ? new Date(String(req.query.endAt)) : now;
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt > endAt) {
      return res.status(400).json({ message: "Período inválido para o painel de reservas." });
    }

    return ResponseHandler(
      res,
      "Painel de reservas carregado.",
      await getReservationsDashboard(getCustomRequest(req).customData.contaId, startAt, endAt),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminListBookings(req: Request, res: Response) {
  try {
    const status = req.query.status && Object.values(ReservaStatus).includes(req.query.status as ReservaStatus)
      ? req.query.status as ReservaStatus
      : undefined;
    return res.json(await listReservations(getCustomRequest(req).customData.contaId, {
      search: req.query.search ? String(req.query.search) : undefined,
      status,
      serviceConfigId: req.query.serviceConfigId ? Number(req.query.serviceConfigId) : undefined,
      resourceId: req.query.resourceId ? Number(req.query.resourceId) : undefined,
      startAt: req.query.startAt ? new Date(String(req.query.startAt)) : undefined,
      endAt: req.query.endAt ? new Date(String(req.query.endAt)) : undefined,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit || req.query.pageSize) || 20,
    }));
  } catch (error) { return errorResponse(res, error); }
}

export async function adminCreateBooking(req: Request, res: Response) {
  try {
    const body = reservationCreateSchema.parse(req.body);
    return ResponseHandler(
      res,
      "Reserva criada.",
      await createInternalReservation(getCustomRequest(req).customData.contaId, body as any),
      201,
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminLinkCustomer(req: Request, res: Response) {
  try {
    const body = reservationLinkCustomerSchema.parse(req.body);
    return ResponseHandler(
      res,
      "Cliente vinculado.",
      await linkReservationCustomer(
        getCustomRequest(req).customData.contaId,
        Number(req.params.id),
        body.clientId,
      ),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminRecordPayment(req: Request, res: Response) {
  try {
    const body = reservationManualPaymentSchema.parse(req.body);
    return ResponseHandler(
      res,
      "Pagamento registrado.",
      await recordManualReservationPayment({
        contaId: getCustomRequest(req).customData.contaId,
        reservationId: Number(req.params.id),
        amount: body.amount,
        method: body.method,
        idempotencyKey: String(req.header("Idempotency-Key") || ""),
      }),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminReschedule(req: Request, res: Response) {
  try {
    const body = reservationRescheduleSchema.parse(req.body);
    return ResponseHandler(
      res,
      "Reserva remarcada.",
      await rescheduleReservation(
        getCustomRequest(req).customData.contaId,
        Number(req.params.id),
        body,
      ),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminRefund(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Solicitação de estorno processada.",
      await requestReservationRefund(
        getCustomRequest(req).customData.contaId,
        Number(req.params.id),
        String(req.header("Idempotency-Key") || ""),
      ),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminAction(req: Request, res: Response) {
  try {
    const action = String(req.params.action || req.path.split("/").filter(Boolean).at(-1));
    if (!["confirm", "complete", "cancel"].includes(action)) {
      return res.status(404).json({ status: 404, message: "Ação não encontrada." });
    }
    return ResponseHandler(
      res,
      "Reserva atualizada.",
      await actOnReservation(
        getCustomRequest(req).customData.contaId,
        Number(req.params.id),
        action as "confirm" | "complete" | "cancel",
        req.body?.reason,
      ),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function adminDeleteBooking(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Reserva excluída.",
      await deleteCanceledReservation(
        getCustomRequest(req).customData.contaId,
        Number(req.params.id),
      ),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function publicStore(req: Request, res: Response) {
  try {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    return ResponseHandler(res, "Página de reservas encontrada.", await getPublicReservationStore(req.params.slug));
  } catch (error) { return errorResponse(res, error); }
}

export async function publicServices(req: Request, res: Response) {
  try {
    const config = await ensurePublicConfig(req.params.slug);
    return ResponseHandler(
      res,
      "Serviços encontrados.",
      await listReservationServiceConfigs(config.contaId, true),
    );
  } catch (error) { return errorResponse(res, error); }
}

async function ensurePublicConfig(slug: string) {
  return getPublicReservationTenant(slug);
}

export async function publicAvailability(req: Request, res: Response) {
  try {
    const config = await ensurePublicConfig(req.params.slug);
    return ResponseHandler(
      res,
      "Horários encontrados.",
      await getReservationAvailability({
        contaId: config.contaId,
        serviceConfigId: Number(req.query.serviceConfigId),
        resourceId: req.query.resourceId ? Number(req.query.resourceId) : null,
        dateFrom: String(req.query.dateFrom),
        dateTo: String(req.query.dateTo),
        publicOnly: true,
      }),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function publicPreview(req: Request, res: Response) {
  try {
    const body = reservationPreviewSchema.parse(req.body);
    const config = await ensurePublicConfig(req.params.slug);
    const services = await listReservationServiceConfigs(config.contaId, true);
    const service = services.find((item) => item.id === body.serviceConfigId);
    if (!service) throw new Error("Serviço de reserva não encontrado.");
    const payment = (await import("../../services/reservas/reservaPolicy")).calculateReservationPayment({
      total: service.Servico.preco,
      policy: service.politicaPagamento,
      fixedDeposit: service.valorSinal,
      percentageDeposit: service.percentualSinal,
    });
    return ResponseHandler(res, "Reserva recalculada.", {
      service: { id: service.id, name: service.Servico.nome },
      durationMinutes: service.duracaoMinutos,
      total: Number(service.Servico.preco),
      paymentAmount: payment.toNumber(),
      paymentPolicy: service.politicaPagamento,
      endAt: new Date(body.startAt.getTime() + service.duracaoMinutos * 60000),
    });
  } catch (error) { return errorResponse(res, error); }
}

export async function publicCreate(req: Request, res: Response) {
  try {
    const body = reservationCreateSchema.parse(req.body);
    const result = await createPublicReservation(
      req.params.slug,
      body,
      String(req.header("Idempotency-Key") || ""),
    );
    return ResponseHandler(res, result.replayed ? "Reserva recuperada." : "Reserva criada.", result, result.replayed ? 200 : 201);
  } catch (error) { return errorResponse(res, error); }
}

export async function publicShow(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Reserva encontrada.",
      await getPublicReservation(req.params.slug, req.params.publicId, token(req)),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function publicReschedule(req: Request, res: Response) {
  try {
    const body = reservationRescheduleSchema.parse(req.body);
    return ResponseHandler(
      res,
      "Reserva remarcada.",
      await reschedulePublicReservation(req.params.slug, req.params.publicId, token(req), body),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function publicCancel(req: Request, res: Response) {
  try {
    const body = reservationCancelSchema.parse(req.body);
    return ResponseHandler(
      res,
      "Reserva cancelada.",
      await cancelPublicReservation(req.params.slug, req.params.publicId, token(req), body.version),
    );
  } catch (error) { return errorResponse(res, error); }
}

export async function publicRetryPayment(req: Request, res: Response) {
  try {
    return ResponseHandler(
      res,
      "Pagamento retomado.",
      await retryPublicReservationPayment(
        req.params.slug,
        req.params.publicId,
        token(req),
        String(req.header("Idempotency-Key") || ""),
      ),
    );
  } catch (error) { return errorResponse(res, error); }
}
