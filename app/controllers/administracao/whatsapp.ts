import { Prisma } from "../../../generated";
import { Request, Response } from "express";
import { z } from "zod";
import {
  publicInstance,
  whatsAppService,
} from "../../services/whatsapp/whatsappService";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { prisma } from "../../utils/prisma";

const updateInstanceSchema = z.object({
  nome: z.string().trim().min(2).optional(),
  instanceId: z.string().trim().min(2).optional(),
  token: z.string().trim().optional().nullable(),
  ativo: z.boolean().optional(),
});

const updateAtendimentoSchema = z.object({
  naoPerturbe: z.boolean().optional(),
  horaInicio: z.string().nullable().optional(),
  horaFim: z.string().nullable().optional(),
});

const webhookUrlsSchema = z.object({
  connected: z.string().url().optional(),
  disconnected: z.string().url().optional(),
  delivery: z.string().url().optional(),
  received: z.string().url().optional(),
  status: z.string().url().optional(),
  presence: z.string().url().optional(),
});

const allowedActions = [
  "qrCode",
  "pairingCode",
  "restart",
  "disconnect",
  "status",
  "device",
  "setupWebhooks",
] as const;

async function resolveInstance(req: Request) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Instância inválida.");
  }

  return prisma.whatsAppInstancia.findUniqueOrThrow({
    where: { id },
    select: { id: true, contaId: true },
  });
}

export async function tableWhatsAppInstancesAdmin(
  req: Request,
  res: Response,
): Promise<any> {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 10, 1), 50);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "TODOS").toUpperCase();
    const contaId = Number(req.query.contaId) || undefined;
    const order: Prisma.SortOrder = req.query.order === "desc" ? "desc" : "asc";
    const requestedSort = String(req.query.sortBy || "updatedAt");
    const sortFields = new Set(["id", "nome", "instanceId", "status", "numeroConectado", "lastSyncAt", "updatedAt"]);
    const sortBy = sortFields.has(requestedSort) ? requestedSort : "updatedAt";

    const where: Prisma.WhatsAppInstanciaWhereInput = {
      ativo: true,
      ...(contaId ? { contaId } : {}),
      ...(status !== "TODOS" &&
      ["PENDENTE", "CONECTADA", "DESCONECTADA", "CONECTANDO", "ERRO"].includes(status)
        ? { status: status as any }
        : {}),
      ...(search
        ? {
            OR: [
              { nome: { contains: search } },
              { instanceId: { contains: search } },
              { numeroConectado: { contains: search } },
              { Conta: { nome: { contains: search } } },
              { Conta: { nomeFantasia: { contains: search } } },
              { Conta: { email: { contains: search } } },
            ],
          }
        : {}),
    };

    const [total, instances] = await Promise.all([
      prisma.whatsAppInstancia.count({ where }),
      prisma.whatsAppInstancia.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: order },
        include: {
          Conta: {
            select: {
              id: true,
              nome: true,
              nomeFantasia: true,
              email: true,
              status: true,
            },
          },
          pagamentos: {
            orderBy: { createdAt: "desc" },
            take: 8,
          },
        },
      }),
    ]);

    return res.json({
      data: instances.map(publicInstance),
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function syncWhatsAppInstanceAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    const result = await whatsAppService.refreshInstanceFromApi(
      await prisma.whatsAppInstancia.findUniqueOrThrow({
        where: { id: instance.id },
        select: {
          id: true,
          contaId: true,
          instanceId: true,
          token: true,
          numeroConectado: true,
        },
      }),
    );
    ResponseHandler(res, "Instância sincronizada", {
      ...(await whatsAppService.getInstance(instance.contaId, instance.id)),
      ...result,
    });
  } catch (error) {
    handleError(res, error);
  }
}

export async function updateWhatsAppInstanceAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    const data = updateInstanceSchema.parse(req.body);
    ResponseHandler(
      res,
      "Instância atualizada",
      await whatsAppService.updateInstance(instance.contaId, instance.id, data),
    );
  } catch (error) {
    handleError(res, error);
  }
}

export async function updateWhatsAppAtendimentoAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    const data = updateAtendimentoSchema.parse(req.body);
    ResponseHandler(
      res,
      "Atendimento da instância atualizado",
      await whatsAppService.updateAtendimento(instance.contaId, instance.id, data),
    );
  } catch (error) {
    handleError(res, error);
  }
}

export async function removeWhatsAppInstanceAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    ResponseHandler(
      res,
      "Instância removida",
      await whatsAppService.removeInstance(instance.contaId, instance.id),
    );
  } catch (error) {
    handleError(res, error);
  }
}

export async function getWhatsAppWebhooksAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    ResponseHandler(
      res,
      "URLs de webhook encontradas",
      await whatsAppService.getInstanceWebhookPreview(instance.contaId, instance.id),
    );
  } catch (error) {
    handleError(res, error);
  }
}

export async function configureWhatsAppWebhooksAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    const webhookUrls = webhookUrlsSchema.optional().parse(req.body?.webhookUrls);
    const result = await whatsAppService.configureInstanceWebhooks(
      instance.contaId,
      instance.id,
      webhookUrls,
    );
    ResponseHandler(
      res,
      result.success ? "Webhooks sincronizados" : "Webhooks sincronizados parcialmente",
      result,
      result.success ? 200 : 207,
    );
  } catch (error) {
    handleError(res, error);
  }
}

export async function listWhatsAppWebhookEventsAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    ResponseHandler(
      res,
      "Eventos de webhook encontrados",
      await whatsAppService.listInstanceWebhookEvents(instance.contaId, instance.id, {
        take: req.query.take ? Number(req.query.take) : undefined,
        tipo: typeof req.query.tipo === "string" && req.query.tipo ? req.query.tipo : undefined,
      }),
    );
  } catch (error) {
    handleError(res, error);
  }
}

export async function whatsappInstanceActionAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    const action = z.enum(allowedActions).parse(req.params.action);
    ResponseHandler(
      res,
      "Ação executada",
      await whatsAppService.callInstanceAction(
        instance.contaId,
        instance.id,
        action,
        req.body?.phone,
      ),
    );
  } catch (error) {
    handleError(res, error);
  }
}

export async function createWhatsAppPixAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    ResponseHandler(
      res,
      "Cobrança PIX gerada",
      await whatsAppService.createPixPayment(instance.contaId, instance.id, {}),
      201,
    );
  } catch (error) {
    handleError(res, error);
  }
}

export async function createWhatsAppCardAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    ResponseHandler(
      res,
      "Checkout de cartão gerado",
      await whatsAppService.createCardSubscription(instance.contaId, instance.id, {}),
      201,
    );
  } catch (error) {
    handleError(res, error);
  }
}

export async function removeWhatsAppPaymentAdmin(req: Request, res: Response): Promise<any> {
  try {
    const instance = await resolveInstance(req);
    ResponseHandler(
      res,
      "Pagamento pendente removido",
      await whatsAppService.removePayment(
        instance.contaId,
        instance.id,
        Number(req.params.paymentId),
      ),
    );
  } catch (error) {
    handleError(res, error);
  }
}
