import { Request, Response } from "express";
import { z } from "zod";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { WhatsAppConversaStatus } from "../../../generated";
import { whatsAppService, WhatsAppWebhookKind } from "../../services/whatsapp/whatsappService";

const createInstanceSchema = z.object({
  nome: z.string().min(2, "Nome da instância é obrigatório"),
  instanceId: z.string().min(2, "Instance ID é obrigatório"),
  token: z.string().min(6, "Token da W-API é obrigatório"),
  ativo: z.boolean().optional(),
});

const updateInstanceSchema = z.object({
  nome: z.string().min(2).optional(),
  instanceId: z.string().min(2).optional(),
  token: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
});

const webhookUrlsSchema = z.object({
  connected: z.string().url().optional(),
  disconnected: z.string().url().optional(),
  delivery: z.string().url().optional(),
  received: z.string().url().optional(),
  status: z.string().url().optional(),
  presence: z.string().url().optional(),
});

const configureWebhooksSchema = z.object({
  webhookUrls: webhookUrlsSchema.optional(),
});

const sendMessageSchema = z.object({
  tipo: z.enum(["text", "image", "audio", "video", "document"]).default("text"),
  conteudo: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  caption: z.string().optional(),
  fileName: z.string().optional(),
  extension: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.tipo === "text" && !data.conteudo?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["conteudo"], message: "Mensagem de texto é obrigatória" });
  }
  if (data.tipo !== "text" && !data.mediaUrl?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mediaUrl"], message: "URL da mídia é obrigatória" });
  }
});

const updateConversationSchema = z.object({
  status: z.nativeEnum(WhatsAppConversaStatus).optional(),
  atendenteId: z.number().int().positive().nullable().optional(),
  setor: z.string().max(80).nullable().optional(),
  fila: z.string().max(80).nullable().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
});

async function requirePermission(req: Request, res: Response, permission: number) {
  const customData = getCustomRequest(req).customData;
  const allowed = await hasPermission(customData, permission);
  if (!allowed) {
    ResponseHandler(res, "Permissão insuficiente para acessar o atendimento WhatsApp", null, 403);
    return null;
  }
  return customData;
}

export const listInstances = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    ResponseHandler(res, "Instâncias encontradas", await whatsAppService.listInstances(customData.contaId));
  } catch (error) {
    handleError(res, error);
  }
};

export const createInstance = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const data = createInstanceSchema.parse(req.body);
    const instance = await whatsAppService.createInstance(customData.contaId, data);
    ResponseHandler(res, "Instância criada", instance, 201);
  } catch (error) {
    handleError(res, error);
  }
};

export const updateInstance = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const data = updateInstanceSchema.parse(req.body);
    const instance = await whatsAppService.updateInstance(customData.contaId, Number(req.params.id), data);
    ResponseHandler(res, "Instância atualizada", instance);
  } catch (error) {
    handleError(res, error);
  }
};

export const getInstanceWebhooks = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const result = await whatsAppService.getInstanceWebhookPreview(customData.contaId, Number(req.params.id));
    ResponseHandler(res, "URLs de webhook encontradas", result);
  } catch (error) {
    handleError(res, error);
  }
};

export const configureInstanceWebhooks = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const data = configureWebhooksSchema.parse(req.body || {});
    const result = await whatsAppService.configureInstanceWebhooks(customData.contaId, Number(req.params.id), data.webhookUrls);
    ResponseHandler(
      res,
      result.success ? "Webhooks sincronizados com a W-API" : "Webhooks sincronizados parcialmente com a W-API",
      result,
      result.success ? 200 : 207,
    );
  } catch (error) {
    handleError(res, error);
  }
};

export const instanceAction = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const action = req.params.action as any;
    const allowed = ["qrCode", "pairingCode", "restart", "disconnect", "status", "device", "setupWebhooks"];
    if (!allowed.includes(action)) return ResponseHandler(res, "Ação inválida para instância", null, 400);
    const result = await whatsAppService.callInstanceAction(customData.contaId, Number(req.params.id), action, req.body?.phone);
    ResponseHandler(res, "Ação executada", result);
  } catch (error) {
    handleError(res, error);
  }
};

export const listConversations = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 1);
    if (!customData) return;
    const status = typeof req.query.status === "string" && req.query.status in WhatsAppConversaStatus ? (req.query.status as WhatsAppConversaStatus) : undefined;
    const result = await whatsAppService.listConversations(customData.contaId, {
      search: String(req.query.search || ""),
      status,
      take: Number(req.query.take || 50),
      cursor: req.query.cursor ? Number(req.query.cursor) : undefined,
    });
    ResponseHandler(res, "Conversas encontradas", result);
  } catch (error) {
    handleError(res, error);
  }
};

export const listMessages = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 1);
    if (!customData) return;
    const result = await whatsAppService.listMessages(customData.contaId, Number(req.params.id), Number(req.query.take || 50), req.query.cursor ? Number(req.query.cursor) : undefined);
    ResponseHandler(res, "Mensagens encontradas", result);
  } catch (error) {
    handleError(res, error);
  }
};

export const sendMessage = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 2);
    if (!customData) return;
    const data = sendMessageSchema.parse(req.body);
    const message = await whatsAppService.sendMessage(customData.contaId, Number(req.params.id), data);
    ResponseHandler(res, "Mensagem enviada", message, 201);
  } catch (error) {
    handleError(res, error);
  }
};

export const updateConversation = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 2);
    if (!customData) return;
    const data = updateConversationSchema.parse(req.body);
    const conversation = await whatsAppService.updateConversation(customData.contaId, Number(req.params.id), data);
    ResponseHandler(res, "Conversa atualizada", conversation);
  } catch (error) {
    handleError(res, error);
  }
};

export const markConversationAsRead = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 1);
    if (!customData) return;
    const conversation = await whatsAppService.markAsRead(customData.contaId, Number(req.params.id));
    ResponseHandler(res, "Conversa marcada como lida", conversation);
  } catch (error) {
    handleError(res, error);
  }
};

export const receiveWebhook = async (req: Request, res: Response): Promise<any> => {
  try {
    const secret = (req.query.secret || req.headers["x-whatsapp-webhook-secret"] || req.headers["x-webhook-secret"]) as string | undefined;
    const kind = (req.query.event || req.body?.event || req.body?.type || "generic") as WhatsAppWebhookKind;
    const result = await whatsAppService.processWebhook(req.params.instanceId, secret, kind, req.body);
    ResponseHandler(res, result.duplicated ? "Webhook já processado" : "Webhook processado", { duplicated: result.duplicated });
  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    if (statusCode === 403 || statusCode === 404) {
      return ResponseHandler(res, error.message, null, statusCode);
    }
    handleError(res, error);
  }
};
