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

const createInstanceAutoSchema = z.object({
  nome: z.string().min(2, "Nome da instância é obrigatório"),
});

const updateInstanceSchema = z.object({
  nome: z.string().min(2).optional(),
  instanceId: z.string().min(2).optional(),
  token: z.string().optional().nullable(),
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

const configureWebhooksSchema = z.object({
  webhookUrls: webhookUrlsSchema.optional(),
});

const paymentRequestSchema = z.object({
  webhookPaymentUrl: z.string().url().optional().nullable(),
});

const sendMessageSchema = z.object({
  tipo: z.enum(["text", "image", "audio", "video", "document"]).default("text"),
  conteudo: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  caption: z.string().optional(),
  fileName: z.string().optional(),
  extension: z.string().optional(),
  quotedMessageId: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.tipo === "text" && !data.conteudo?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["conteudo"], message: "Mensagem de texto é obrigatória" });
  }
  if (data.tipo !== "text" && !data.mediaUrl?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mediaUrl"], message: "URL da mídia é obrigatória" });
  }
});

const startConversationSchema = z
  .object({
    clienteId: z.coerce.number().int().positive({ message: "Cliente inválido" }).optional(),
    contatoId: z.coerce.number().int().positive({ message: "Contato inválido" }).optional(),
    instanciaId: z.coerce.number().int().positive().optional(),
  })
  .refine((data) => Boolean(data.clienteId || data.contatoId), {
    message: "Informe um cliente ou contato para iniciar a conversa",
  });

const updateConversationSchema = z.object({
  status: z.nativeEnum(WhatsAppConversaStatus).optional(),
  atendenteId: z.number().int().positive().nullable().optional(),
  setor: z.string().max(80).nullable().optional(),
  fila: z.string().max(80).nullable().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
});

const updateContactSchema = z.object({
  nome: z.string().max(120).nullable().optional(),
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

export const createInstanceAuto = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const data = createInstanceAutoSchema.parse(req.body);
    const result = await whatsAppService.createInstanceAuto(customData.contaId, data);
    ResponseHandler(res, "Instância gerada", result, 201);
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

export const removeInstance = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const instance = await whatsAppService.removeInstance(customData.contaId, Number(req.params.id));
    ResponseHandler(res, "Instancia removida", instance);
  } catch (error) {
    handleError(res, error);
  }
};

// Controle de atendimento da instância (não perturbe + janela de horário), sem desconectar a API.
export const updateInstanceAtendimento = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 2);
    if (!customData) return;
    const data = updateAtendimentoSchema.parse(req.body);
    const instance = await whatsAppService.updateAtendimento(customData.contaId, Number(req.params.id), data);
    ResponseHandler(res, "Atendimento da instância atualizado", instance);
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

export const listInstanceWebhookEvents = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const events = await whatsAppService.listInstanceWebhookEvents(customData.contaId, Number(req.params.id), {
      take: req.query.take ? Number(req.query.take) : undefined,
      tipo: typeof req.query.tipo === "string" && req.query.tipo ? req.query.tipo : undefined,
    });
    ResponseHandler(res, "Eventos de webhook encontrados", events);
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

export const createPixPayment = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const data = paymentRequestSchema.parse(req.body || {});
    const payment = await whatsAppService.createPixPayment(customData.contaId, Number(req.params.id), data);
    ResponseHandler(res, "Cobranca PIX gerada", payment, 201);
  } catch (error) {
    handleError(res, error);
  }
};

export const createCardSubscription = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const data = paymentRequestSchema.parse(req.body || {});
    const payment = await whatsAppService.createCardSubscription(customData.contaId, Number(req.params.id), data);
    ResponseHandler(res, "Checkout de cartao gerado", payment, 201);
  } catch (error) {
    handleError(res, error);
  }
};

export const removePayment = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 5);
    if (!customData) return;
    const payment = await whatsAppService.removePayment(
      customData.contaId,
      Number(req.params.id),
      Number(req.params.paymentId)
    );
    ResponseHandler(res, "Pagamento pendente removido", payment);
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
      instanciaId: req.query.instanciaId ? Number(req.query.instanciaId) : undefined,
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

export const getMessageMedia = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 1);
    if (!customData) return;
    const media = await whatsAppService.getMessageMedia(customData.contaId, Number(req.params.id));
    res.setHeader("Content-Type", media.mimetype || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=86400");
    if (media.fileName) {
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(media.fileName)}"`);
    }
    return res.send(media.buffer);
  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    if (statusCode >= 400 && statusCode < 500) {
      return ResponseHandler(res, error.message, null, statusCode);
    }
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

// Envio de imagem a partir do dispositivo (multipart, campo "file"): faz scale down, sobe no
// storage público e envia a URL na conversa. Espera multer.single("file") na rota.
export const sendImageMessage = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 2);
    if (!customData) return;
    if (!req.file) {
      return ResponseHandler(res, "Nenhuma imagem enviada", null, 400);
    }
    if (!req.file.mimetype?.startsWith("image/")) {
      return ResponseHandler(res, "O arquivo enviado não é uma imagem", null, 400);
    }
    const message = await whatsAppService.sendImageMessage(customData.contaId, Number(req.params.id), {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      caption: typeof req.body.caption === "string" ? req.body.caption : undefined,
      quotedMessageId: typeof req.body.quotedMessageId === "string" ? req.body.quotedMessageId : undefined,
    });
    ResponseHandler(res, "Imagem enviada", message, 201);
  } catch (error) {
    handleError(res, error);
  }
};

// Envio de áudio gravado (multipart, campo "file"): transcoda p/ OGG, sobe no storage e envia a
// URL como nota de voz. Espera multer.single("file") na rota.
export const sendAudioMessage = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 2);
    if (!customData) return;
    if (!req.file) {
      return ResponseHandler(res, "Nenhum áudio enviado", null, 400);
    }
    if (!req.file.mimetype?.startsWith("audio/")) {
      return ResponseHandler(res, "O arquivo enviado não é um áudio", null, 400);
    }
    const message = await whatsAppService.sendAudioMessage(customData.contaId, Number(req.params.id), {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      quotedMessageId: typeof req.body.quotedMessageId === "string" ? req.body.quotedMessageId : undefined,
    });
    ResponseHandler(res, "Áudio enviado", message, 201);
  } catch (error) {
    handleError(res, error);
  }
};

export const startConversation = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 2);
    if (!customData) return;
    const data = startConversationSchema.parse(req.body);
    const conversation = await whatsAppService.startConversation(customData.contaId, data);
    ResponseHandler(res, "Conversa iniciada", conversation, 201);
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

export const removeConversation = async (req: Request, res: Response): Promise<any> => {
  try {
    // Apagar chats é restrito a administradores (nível 4: admin/root).
    const customData = await requirePermission(req, res, 4);
    if (!customData) return;
    const result = await whatsAppService.removeConversation(customData.contaId, Number(req.params.id));
    ResponseHandler(res, "Conversa apagada", result);
  } catch (error) {
    handleError(res, error);
  }
};

export const listContacts = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 1);
    if (!customData) return;
    const result = await whatsAppService.listContacts(customData.contaId, {
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      take: req.query.take ? Number(req.query.take) : undefined,
      cursor: req.query.cursor ? Number(req.query.cursor) : undefined,
    });
    ResponseHandler(res, "Contatos encontrados", result);
  } catch (error) {
    handleError(res, error);
  }
};

// Endpoint no formato select2 ({ results: [{ id, label }] }) para o componente Select2Ajax.
export const select2Contacts = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 1);
    if (!customData) return;
    const results = await whatsAppService.select2Contacts(customData.contaId, {
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      id: req.query.id ? Number(req.query.id) : undefined,
    });
    return res.json({ results });
  } catch (error) {
    return res.json({ results: [] });
  }
};

export const updateContact = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 2);
    if (!customData) return;
    const data = updateContactSchema.parse(req.body);
    const contato = await whatsAppService.updateContact(customData.contaId, Number(req.params.id), data);
    ResponseHandler(res, "Contato atualizado", contato);
  } catch (error) {
    handleError(res, error);
  }
};

export const removeContact = async (req: Request, res: Response): Promise<any> => {
  try {
    // Apagar contatos é restrito a administradores (nível 4: admin/root).
    const customData = await requirePermission(req, res, 4);
    if (!customData) return;
    const result = await whatsAppService.removeContact(customData.contaId, Number(req.params.id));
    ResponseHandler(res, "Contato apagado", result);
  } catch (error) {
    handleError(res, error);
  }
};

export const listConversationSales = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 2);
    if (!customData) return;
    const result = await whatsAppService.listConversationSales(
      customData.contaId,
      Number(req.params.id),
      typeof req.query.search === "string" ? req.query.search : undefined,
    );
    ResponseHandler(res, "Vendas do cliente encontradas", result);
  } catch (error) {
    handleError(res, error);
  }
};

const sendConversationSaleSchema = z.object({
  vendaId: z.coerce.number().int().positive({ message: "Venda inválida" }),
});

export const sendConversationSale = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 2);
    if (!customData) return;
    const data = sendConversationSaleSchema.parse(req.body);
    const message = await whatsAppService.sendConversationSale(
      customData.contaId,
      Number(req.params.id),
      data.vendaId,
    );
    ResponseHandler(res, "Dados da venda enviados", message, 201);
  } catch (error) {
    handleError(res, error);
  }
};

export const attendConversation = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requirePermission(req, res, 2);
    if (!customData) return;
    const conversation = await whatsAppService.attendConversation(
      customData.contaId,
      Number(req.params.id),
      customData.userId,
    );
    ResponseHandler(res, "Atendimento assumido", conversation);
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
    const kind = (req.query.event || req.body?.event || req.body?.type || "generic") as WhatsAppWebhookKind;
    const result = await whatsAppService.processWebhook(req.params.instanceId, kind, req.body);
    ResponseHandler(res, result.duplicated ? "Webhook já processado" : "Webhook processado", { duplicated: result.duplicated });
  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    if (statusCode === 403 || statusCode === 404) {
      return ResponseHandler(res, error.message, null, statusCode);
    }
    handleError(res, error);
  }
};

export const receivePaymentWebhook = async (req: Request, res: Response): Promise<any> => {
  try {
    const secret = (req.query.secret || req.headers["x-whatsapp-webhook-secret"] || req.headers["x-webhook-secret"]) as string | undefined;
    const result = await whatsAppService.processPaymentWebhook(req.params.instanceId, secret, req.body);
    ResponseHandler(res, result.updated ? "Pagamento WhatsApp atualizado" : "Pagamento WhatsApp recebido sem vinculo", result);
  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    if (statusCode === 403 || statusCode === 404) {
      return ResponseHandler(res, error.message, null, statusCode);
    }
    handleError(res, error);
  }
};
