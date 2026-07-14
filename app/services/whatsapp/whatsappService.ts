import crypto from "crypto";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Prisma, WhatsAppConversaStatus, WhatsAppInstanciaStatus, WhatsAppMensagemDirecao, WhatsAppMensagemStatus, WhatsAppMensagemTipo } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";
import { formatCurrency } from "../../utils/formatters";
import { WApiClient, WApiMessageKind, WApiWebhookUrls, WAPI_WEBHOOK_ENDPOINTS } from "./wApiClient";
import { downloadAndDecryptWhatsAppMedia, DecryptedWhatsAppMedia, WhatsAppMediaError } from "./whatsappMedia";
import { whatsAppAgentService, withinBusinessHours, normalizeHora } from "./whatsappAgentService";
import {
  buildDeletedWhatsAppInstanceId,
  buildWApiPaymentPayload,
  canDeleteWhatsAppPayment,
  mapWApiInstanceStatusFromPayload,
  mapWApiPaymentStatus,
} from "./whatsappPolicy";
import {
  sendWhatsAppContactDeleted,
  sendWhatsAppConversationDeleted,
  sendWhatsAppConversationUpdated,
  sendWhatsAppInstanceUpdated,
  sendWhatsAppMessageCreated,
} from "../../hooks/whatsapp/socket";
import { buildScopedUploadKey, uploadPublicFile } from "../uploads/fileStorageService";
import { downscaleImage } from "../uploads/imageProcessingService";
import { transcodeAudioToOgg } from "../uploads/audioProcessingService";

const DEFAULT_TAKE = 50;
const MAX_TAKE = 100;

export type WhatsAppWebhookKind = "received" | "delivery" | "status" | "connected" | "disconnected" | "presence" | "generic";

export interface CreateInstanceInput {
  nome: string;
  instanceId: string;
  token: string;
  ativo?: boolean;
}

export interface CreateInstanceAutoInput {
  nome: string;
}

export interface UpdateInstanceInput {
  nome?: string;
  instanceId?: string;
  token?: string | null;
  ativo?: boolean;
}

export interface CreateInstancePaymentInput {
  webhookPaymentUrl?: string | null;
}

export interface SendMessageInput {
  tipo?: "text" | "image" | "audio" | "video" | "document";
  conteudo?: string;
  mediaUrl?: string;
  caption?: string;
  fileName?: string;
  extension?: string;
  // Id externo da mensagem que está sendo respondida (citada). Quando presente, a W-API envia
  // como resposta marcando a mensagem original.
  quotedMessageId?: string;
}

export interface SendLocationInput {
  latitude: number | string;
  longitude: number | string;
  name: string;
  address: string;
  quotedMessageId?: string;
}

export interface SendContactInput {
  contactName: string;
  contactPhone: string;
  contactBusinessDescription?: string;
  quotedMessageId?: string;
}

export interface ConversationFilters {
  search?: string;
  status?: WhatsAppConversaStatus;
  instanciaId?: number;
  take?: number;
  cursor?: number;
}

function normalizePhone(value?: string | null) {
  if (!value) return "";
  const clean = String(value).replace(/@.*/, "").replace(/\D/g, "");
  return clean.startsWith("55") || clean.length < 11 ? clean : `55${clean}`;
}

// Monta um vCard (3.0) no mesmo formato que a W-API entrega nas mensagens recebidas, para que o
// balão de contato enviado por nós seja lido pelo mesmo parser do frontend (nome + telefone).
function buildVCard(name: string, phone: string, businessDescription?: string | null) {
  const digits = String(phone || "").replace(/\D/g, "");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:;${name};;;`,
    `FN:${name}`,
    ...(businessDescription ? [`X-WA-BIZ-NAME:${businessDescription}`] : []),
    `TEL;type=CELL;type=VOICE;waid=${digits}:${phone}`,
    "END:VCARD",
  ];
  return lines.join("\n");
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function hashPayload(payload: unknown) {
  return crypto.createHash("sha256").update(safeJson(payload)).digest("hex");
}

function publicInstance(instance: any) {
  if (!instance) return instance;
  const { token: _token, webhookSecret: _webhookSecret, pagamentos, ...rest } = instance;
  return {
    ...rest,
    tokenConfigurado: Boolean(instance.token),
    ...(Array.isArray(pagamentos) ? { pagamentos: pagamentos.map(publicPayment) } : {}),
  };
}

function publicPayment(payment: any) {
  if (!payment) return payment;
  const { rawPayload: _rawPayload, ...rest } = payment;
  return rest;
}

// Atendimento pausado para esta instância: "não perturbe" ligado, ou fora da janela de horário
// configurada. Enquanto pausado, a instância segue conectada na W-API mas paramos de salvar os
// eventos de mensagem recebida.
function instanceAtendimentoPaused(instance: {
  atendimentoNaoPerturbe: boolean;
  atendimentoHoraInicio: string | null;
  atendimentoHoraFim: string | null;
}): boolean {
  if (instance.atendimentoNaoPerturbe) return true;
  return !withinBusinessHours(instance.atendimentoHoraInicio, instance.atendimentoHoraFim);
}

function mapMessageStatus(payload: any): WhatsAppMensagemStatus {
  const text = String(payload?.status || payload?.data?.status || payload?.ack || payload?.data?.ack || "").toLowerCase();
  if (["read", "lida", "played", "4"].includes(text) || text.includes("read")) return WhatsAppMensagemStatus.LIDA;
  if (["delivered", "entregue", "3"].includes(text) || text.includes("deliver")) return WhatsAppMensagemStatus.ENTREGUE;
  if (["sent", "enviada", "server_ack", "2"].includes(text) || text.includes("sent")) return WhatsAppMensagemStatus.ENVIADA;
  if (["error", "erro", "failed"].some((term) => text.includes(term))) return WhatsAppMensagemStatus.ERRO;
  return WhatsAppMensagemStatus.PENDENTE;
}

function normalizeMessageType(value?: string | null): WhatsAppMensagemTipo {
  const type = String(value || "").toLowerCase();
  if (type.includes("image") || type.includes("imagem")) return WhatsAppMensagemTipo.IMAGEM;
  if (type.includes("audio") || type.includes("áudio")) return WhatsAppMensagemTipo.AUDIO;
  if (type.includes("video") || type.includes("vídeo")) return WhatsAppMensagemTipo.VIDEO;
  if (type.includes("document") || type.includes("arquivo")) return WhatsAppMensagemTipo.DOCUMENTO;
  if (type.includes("sticker")) return WhatsAppMensagemTipo.STICKER;
  if (type.includes("location")) return WhatsAppMensagemTipo.LOCALIZACAO;
  if (type.includes("contact")) return WhatsAppMensagemTipo.CONTATO;
  if (type.includes("link")) return WhatsAppMensagemTipo.LINK;
  if (!type || type.includes("text") || type.includes("conversation")) return WhatsAppMensagemTipo.TEXTO;
  return WhatsAppMensagemTipo.OUTRO;
}

// Extrai um resumo textual de um conteúdo de mensagem da W-API (o mesmo formato de `msgContent`).
// Usado tanto para o corpo da mensagem quanto para o trecho citado numa resposta.
function extractTextFromContent(content: any): string {
  if (!content || typeof content !== "object") return "";
  const text =
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    content?.documentMessage?.caption ||
    content?.text ||
    content?.body ||
    "";
  if (typeof text === "string" && text.trim()) return text;
  if (content?.imageMessage) return "[imagem]";
  if (content?.stickerMessage) return "[figurinha]";
  if (content?.videoMessage) return "[vídeo]";
  if (content?.audioMessage) return "[áudio]";
  if (content?.documentMessage) return content?.documentMessage?.fileName || "[documento]";
  if (content?.locationMessage) return `📍 ${content?.locationMessage?.name || "Localização"}`;
  if (content?.contactMessage) return `👤 ${content?.contactMessage?.displayName || "Contato"}`;
  return "";
}

// Localiza o `contextInfo` (metadados de resposta/citação) dentro de um conteúdo, olhando os
// vários tipos de mensagem (texto, imagem, vídeo, ...).
function findContextInfo(content: any): any {
  if (!content || typeof content !== "object") return null;
  if (content?.contextInfo) return content.contextInfo;
  const messageKey = Object.keys(content).find((chave) => chave.endsWith("Message") && content[chave]?.contextInfo);
  return messageKey ? content[messageKey].contextInfo : null;
}

function extractMessagePayload(payload: any) {
  // Formato real da W-API (event "webhookReceived"): campos no topo do payload + `msgContent`
  // com o conteúdo (conversation, extendedTextMessage, imageMessage, ...). Mantemos fallbacks
  // para o formato aninhado (data.message/message) por segurança.
  const content = payload?.msgContent || payload?.data?.message || payload?.message?.message || payload?.message || payload?.data || {};
  const sender = payload?.sender || {};
  const chat = payload?.chat || {};
  const key = payload?.key || payload?.data?.key || {};

  const fromMe = Boolean(payload?.fromMe ?? key?.fromMe ?? payload?.data?.fromMe);
  const senderId = String(sender?.id ?? "").trim();
  // `chat.id` identifica o chat: número@s.whatsapp.net, um @lid, `@g.us` (grupo) ou "status"
  // (transmissões de status/stories). Usamos isso para ignorar grupos e status.
  const chatId = String(chat?.id ?? key?.remoteJid ?? "");
  const isGroup = Boolean(payload?.isGroup) || chatId.endsWith("@g.us");
  const isStatusBroadcast = chatId === "status" || chatId.startsWith("status@");
  // Canais/newsletters do WhatsApp chegam sem remetente real (`sender.id` vazio) e com um
  // `chat.id` que não é um telefone. Não são atendimento 1:1, então são ignorados.
  const isChannel = chatId.endsWith("@newsletter") || (!fromMe && senderId === "");

  const externalMessageId = String(
    payload?.messageId || payload?.data?.messageId || payload?.id || key?.id || payload?.data?.id || hashPayload(payload),
  );

  // O número real do contato vem em `sender.id` (o `chat.id` pode ser um @lid sem o número).
  // Para mensagens enviadas por nós (fromMe) o contato é o outro lado da conversa (chat.id).
  const contactRaw =
    (fromMe ? chat?.id || senderId : senderId || chat?.id) ||
    payload?.phone ||
    payload?.from ||
    "";
  const phone = normalizePhone(contactRaw);

  const text =
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    content?.documentMessage?.caption ||
    content?.text ||
    content?.body ||
    payload?.text ||
    (content?.locationMessage ? `📍 ${content?.locationMessage?.name || "Localização"}` : "") ||
    (content?.contactMessage ? `👤 ${content?.contactMessage?.displayName || "Contato"}` : "") ||
    "";
  const mediaUrl =
    content?.imageMessage?.URL ||
    content?.imageMessage?.url ||
    content?.stickerMessage?.URL ||
    content?.stickerMessage?.url ||
    content?.audioMessage?.URL ||
    content?.audioMessage?.url ||
    content?.videoMessage?.URL ||
    content?.videoMessage?.url ||
    content?.documentMessage?.URL ||
    content?.documentMessage?.url ||
    content?.mediaUrl ||
    content?.url ||
    null;
  const rawType =
    Object.keys(content || {}).find((chave) => chave.endsWith("Message")) ||
    (content?.conversation ? "conversation" : content?.type || content?.messageType || payload?.type || "text");

  // Resposta/citação: `contextInfo.stanzaID` referencia a mensagem citada e `quotedMessage`
  // traz o conteúdo dela (usado como preview quando a mensagem original não está carregada).
  const contextInfo = findContextInfo(content);
  const quotedMessageId = String(contextInfo?.stanzaID || contextInfo?.stanzaId || "") || null;
  const quotedConteudo = contextInfo?.quotedMessage ? extractTextFromContent(contextInfo.quotedMessage) || null : null;

  return {
    externalMessageId,
    quotedMessageId,
    quotedConteudo,
    phone,
    fromMe,
    isGroup,
    isStatusBroadcast,
    isChannel,
    chatId,
    tipo: normalizeMessageType(rawType),
    conteudo: typeof text === "string" ? text : safeJson(text),
    mediaUrl,
    mediaMimeType:
      content?.imageMessage?.mimetype ||
      content?.stickerMessage?.mimetype ||
      content?.videoMessage?.mimetype ||
      content?.audioMessage?.mimetype ||
      content?.documentMessage?.mimetype ||
      content?.mimeType ||
      null,
    fileName: content?.documentMessage?.fileName || content?.documentMessage?.title || content?.fileName || null,
    pushName: sender?.pushName || payload?.pushName || payload?.senderName || null,
    foto: chat?.profilePicture || sender?.profilePicture || null,
  };
}

type ReacaoMensagem = { emoji: string; fromMe: boolean; senderId: string | null };

// Chave que identifica o autor de uma reação num chat 1:1: cada participante tem no máximo
// uma reação por mensagem, então uma nova reação do mesmo autor substitui a anterior.
function reactionKey(r: Pick<ReacaoMensagem, "fromMe" | "senderId">): string {
  return r.fromMe ? "__me__" : r.senderId || "__them__";
}

// Aplica uma reação (novo emoji, ou remoção quando o emoji vem vazio) sobre a lista atual de
// reações de uma mensagem, mantendo apenas uma reação por autor. Retorna o JSON serializado
// (ou null quando não sobra nenhuma reação).
function mergeReactions(existing: string | null | undefined, entry: ReacaoMensagem): string | null {
  let list: ReacaoMensagem[] = [];
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const key = reactionKey(entry);
  list = list.filter((r) => reactionKey(r) !== key);
  if (entry.emoji) list.push({ emoji: entry.emoji, fromMe: entry.fromMe, senderId: entry.senderId });
  return list.length ? JSON.stringify(list) : null;
}

// Trata o evento `reactionMessage` da W-API: não cria um balão próprio (que aparecia como
// "Mídia"); localiza a mensagem reagida (`reactionMessage.key.ID`) e guarda/atualiza a reação
// nela, reemitindo a mensagem para o front exibir o emoji abaixo do balão.
async function applyReaction(
  instance: { id: number; contaId: number },
  payload: any,
  reactionMessage: any,
): Promise<void> {
  const reactedId = String(reactionMessage?.key?.ID || reactionMessage?.key?.id || "");
  if (!reactedId) return;

  const emoji = typeof reactionMessage?.text === "string" ? reactionMessage.text : "";
  const fromMe = Boolean(payload?.fromMe ?? reactionMessage?.key?.fromMe);
  const senderId = String(payload?.sender?.id ?? "").trim() || null;

  const target = await prisma.whatsAppMensagem.findFirst({
    where: { contaId: instance.contaId, instanciaId: instance.id, externalMessageId: reactedId },
  });
  if (!target) return;

  const reacoes = mergeReactions(target.reacoes, { emoji, fromMe, senderId });
  if (reacoes === (target.reacoes ?? null)) return;

  const updated = await prisma.whatsAppMensagem.update({
    where: { id: target.id },
    data: { reacoes },
  });
  sendWhatsAppMessageCreated(instance.contaId, updated);
}

async function findAutoCliente(contaId: number, phone: string) {
  if (!phone) return null;
  const lastDigits = phone.slice(-8);
  return prisma.clientesFornecedores.findFirst({
    where: {
      contaId,
      OR: [
        { telefone: { contains: phone } },
        { whastapp: { contains: phone } },
        ...(lastDigits ? [{ telefone: { contains: lastDigits } }, { whastapp: { contains: lastDigits } }] : []),
      ],
    },
    select: { id: true, nome: true, telefone: true, whastapp: true },
  });
}

async function getInstanceById(contaId: number, id: number) {
  const instance = await prisma.whatsAppInstancia.findFirst({ where: { id, contaId } });
  if (!instance) throw new Error("Instância de WhatsApp não encontrada para esta conta");
  return instance;
}

// A W-API não repassa query params (ex.: `?secret=`) ao chamar o webhook de volta, então
// as URLs registradas carregam apenas o evento. A instância é identificada pelo `instanceId`
// na própria rota e não há validação de segredo no webhook de mensagens (ver processWebhook).
function buildWebhookUrls(instanceId: string): Record<keyof WApiWebhookUrls, string> {
  const base = env.BASE_URL.replace(/\/$/, "");
  const url = `${base}/api/whatsapp/webhooks/${encodeURIComponent(instanceId)}`;
  return {
    connected: `${url}?event=connected`,
    disconnected: `${url}?event=disconnected`,
    delivery: `${url}?event=delivery`,
    received: `${url}?event=received`,
    status: `${url}?event=status`,
    presence: `${url}?event=presence`,
  };
}

function buildWebhookPreview(instanceId: string) {
  const webhookUrls = buildWebhookUrls(instanceId);
  return {
    webhookUrls,
    callbacks: WAPI_WEBHOOK_ENDPOINTS.map((item) => ({
      key: item.key,
      label: item.label,
      endpoint: item.endpoint,
      url: webhookUrls[item.key],
    })),
  };
}

function buildPaymentWebhookUrl(instanceId: string, secret: string) {
  const base = env.BASE_URL.replace(/\/$/, "");
  return `${base}/api/whatsapp/payments/webhooks/${encodeURIComponent(instanceId)}?secret=${encodeURIComponent(secret)}`;
}

async function getContaEmail(contaId: number) {
  const conta = await prisma.contas.findUnique({
    where: { id: contaId },
    select: { email: true },
  });

  if (!conta?.email) {
    throw new Error("E-mail da conta nao encontrado para gerar pagamento WhatsApp");
  }

  return conta.email;
}

function extractPaymentIdentifier(payload: any, key: "paymentId" | "sessionId") {
  const value =
    payload?.[key] ||
    payload?.data?.[key] ||
    payload?.payment?.[key] ||
    payload?.subscription?.[key];

  return value === undefined || value === null ? null : String(value);
}

function assertWApiPaymentCreated(result: any, fallbackMessage: string) {
  if (result?.error === true || result?.data?.error === true) {
    throw new Error(result?.message || result?.data?.message || fallbackMessage);
  }
}

const VENDA_STATUS_LABEL: Record<string, string> = {
  ORCAMENTO: "Orçamento",
  FATURADO: "Faturado",
  ANDAMENTO: "Em andamento",
  FINALIZADO: "Finalizado",
  PENDENTE: "Pendente",
  CANCELADO: "Cancelado",
};

type VendaComItens = Prisma.VendasGetPayload<{
  include: {
    ItensVendas: { include: { produto: { select: { nome: true } }; servico: { select: { nome: true } } } };
    PagamentoVendas: true;
  };
}>;

function buildVendaResumoMessage(venda: VendaComItens, clienteNome: string) {
  const nome = clienteNome?.trim() || "cliente";
  const subtotal = Number(venda.valor || 0);
  const desconto = Number(venda.desconto || 0);
  const total = Math.max(0, subtotal - desconto);
  const dataVenda = format(new Date(venda.data), "dd/MM/yyyy", { locale: ptBR });

  const linhas = venda.ItensVendas.map((item) => {
    const itemNome = item.itemName || item.produto?.nome || item.servico?.nome || "Item";
    const totalLinha = Number(item.valor || 0) * Number(item.quantidade || 0);
    return `• ${item.quantidade}x ${itemNome} — ${formatCurrency(totalLinha)}`;
  });

  const partes = [
    `Olá, ${nome}! 🧾`,
    ``,
    `Resumo da venda *${venda.Uid}*`,
    `Data: ${dataVenda}`,
    `Status: ${VENDA_STATUS_LABEL[venda.status] || venda.status}`,
  ];

  if (linhas.length) {
    partes.push(``, ...linhas);
  }

  partes.push(``, `Subtotal: ${formatCurrency(subtotal)}`);
  if (desconto > 0) {
    partes.push(`Desconto: ${formatCurrency(desconto)}`);
  }
  partes.push(`*Total: ${formatCurrency(total)}*`);

  if (venda.PagamentoVendas?.metodo) {
    partes.push(`Pagamento: ${venda.PagamentoVendas.metodo}`);
  }

  if (venda.observacoes?.trim()) {
    partes.push(``, `Obs.: ${venda.observacoes.trim()}`);
  }

  return partes.join("\n");
}

export const whatsAppService = {
  normalizePhone,

  async listInstances(contaId: number) {
    const instances = await prisma.whatsAppInstancia.findMany({
      where: { contaId, ativo: true },
      include: {
        pagamentos: {
          orderBy: { createdAt: "desc" },
          take: 8,
        },
      },
      orderBy: [{ ativo: "desc" }, { updatedAt: "desc" }],
    });
    return instances.map(publicInstance);
  },

  async createInstance(contaId: number, input: CreateInstanceInput) {
    const instance = await prisma.whatsAppInstancia.create({
      data: {
        contaId,
        nome: input.nome.trim(),
        instanceId: input.instanceId.trim(),
        token: input.token.trim(),
        ativo: input.ativo ?? true,
        webhookSecret: crypto.randomBytes(32).toString("hex"),
      },
    });
    sendWhatsAppInstanceUpdated(contaId, publicInstance(instance));
    return publicInstance(instance);
  },

  // Criação automática: provisiona uma instância nova na W-API usando o token de conta
  // (WHATSAPP_WAPI_ACCOUNT_TOKEN) e só o nome informado pelo usuário. Persiste o instanceId/token
  // retornados (reaproveitando `createInstance`, que esconde o token da resposta) e registra os
  // webhooks com o instanceId real. A instância nasce com 7 dias de trial grátis.
  async createInstanceAuto(contaId: number, input: CreateInstanceAutoInput) {
    const accountToken = env.WHATSAPP_WAPI_ACCOUNT_TOKEN;
    if (!accountToken) {
      throw new Error("Token de conta W-API não configurado (WHATSAPP_WAPI_ACCOUNT_TOKEN)");
    }

    const nome = input.nome.trim();
    const result = await WApiClient.createClientInstance({ apiKey: accountToken, instanceName: nome });

    if (result?.error === true || !result?.instanceId || !result?.token) {
      throw new Error(result?.message || "Falha ao gerar instância na W-API");
    }

    const instance = await this.createInstance(contaId, {
      nome,
      instanceId: result.instanceId,
      token: result.token,
    });

    // Registra os webhooks já com o instanceId real. Não falha a criação se der erro: a
    // instância já existe e os webhooks podem ser reconfigurados em "Gerenciar instância".
    try {
      await this.configureInstanceWebhooks(contaId, instance.id);
    } catch (error) {
      console.warn(`[whatsapp] Falha ao registrar webhooks da instância gerada id=${instance.id}`, error);
    }

    return { instance, isTrial: result.isTrial ?? true, trialDays: 7 };
  },

  async updateInstance(contaId: number, id: number, input: UpdateInstanceInput) {
    await getInstanceById(contaId, id);
    const data: Prisma.WhatsAppInstanciaUpdateInput = {};
    if (typeof input.nome === "string") data.nome = input.nome.trim();
    if (typeof input.instanceId === "string") data.instanceId = input.instanceId.trim();
    if (typeof input.ativo === "boolean") data.ativo = input.ativo;
    if (typeof input.token === "string" && input.token.trim()) data.token = input.token.trim();

    const instance = await prisma.whatsAppInstancia.update({ where: { id }, data });
    sendWhatsAppInstanceUpdated(contaId, publicInstance(instance));
    return publicInstance(instance);
  },

  // Atualiza o controle de atendimento da instância (não perturbe + janela de horário), sem tocar
  // na conexão da W-API. Enquanto pausada, a instância para de salvar os eventos de mensagem.
  async updateAtendimento(
    contaId: number,
    id: number,
    input: { naoPerturbe?: boolean; horaInicio?: string | null; horaFim?: string | null },
  ) {
    await getInstanceById(contaId, id);
    const data: Prisma.WhatsAppInstanciaUpdateInput = {};
    if (typeof input.naoPerturbe === "boolean") data.atendimentoNaoPerturbe = input.naoPerturbe;
    if ("horaInicio" in input) data.atendimentoHoraInicio = normalizeHora(input.horaInicio);
    if ("horaFim" in input) data.atendimentoHoraFim = normalizeHora(input.horaFim);

    const instance = await prisma.whatsAppInstancia.update({ where: { id }, data });
    sendWhatsAppInstanceUpdated(contaId, publicInstance(instance));
    return publicInstance(instance);
  },

  async removeInstance(contaId: number, id: number) {
    const instance = await getInstanceById(contaId, id);

    const updated = await prisma.whatsAppInstancia.update({
      where: { id },
      data: {
        ativo: false,
        status: WhatsAppInstanciaStatus.DESCONECTADA,
        instanceId: buildDeletedWhatsAppInstanceId(instance.instanceId, id),
        token: "",
        ultimoErro: null,
        lastSyncAt: new Date(),
      },
    });

    sendWhatsAppInstanceUpdated(contaId, publicInstance(updated));
    return publicInstance(updated);
  },

  async removePayment(contaId: number, instanceId: number, paymentId: number) {
    await getInstanceById(contaId, instanceId);
    const payment = await prisma.whatsAppInstanciaPagamento.findFirst({
      where: {
        id: paymentId,
        contaId,
        instanciaId: instanceId,
      },
    });

    if (!payment) {
      throw new Error("Pagamento WhatsApp nao encontrado para esta instancia.");
    }

    if (!canDeleteWhatsAppPayment(payment)) {
      throw new Error("Apenas pagamentos pendentes podem ser apagados.");
    }

    const deleted = await prisma.whatsAppInstanciaPagamento.delete({
      where: {
        id: payment.id,
      },
    });

    const instance = await getInstanceById(contaId, instanceId);
    sendWhatsAppInstanceUpdated(contaId, publicInstance(instance));
    return publicPayment(deleted);
  },

  async getInstance(contaId: number, id: number) {
    return publicInstance(await getInstanceById(contaId, id));
  },

  async getInstanceWebhookPreview(contaId: number, id: number) {
    const instance = await getInstanceById(contaId, id);
    return {
      instance: publicInstance(instance),
      ...buildWebhookPreview(instance.instanceId),
    };
  },

  // Logs de webhook recebidos e persistidos para a instância (tabela WhatsAppWebhookEvento).
  // Útil para diagnosticar quando eventos "received" (mensagens do cliente) não chegam:
  // se não aparecem aqui, a W-API não está entregando o webhook ao backend (URL/segredo/BASE_URL);
  // se aparecem com `erro`, o problema é no processamento.
  async listInstanceWebhookEvents(contaId: number, id: number, filters: { take?: number; tipo?: string } = {}) {
    await getInstanceById(contaId, id);
    const take = Math.min(Math.max(Number(filters.take || 40), 1), 100);
    const events = await prisma.whatsAppWebhookEvento.findMany({
      where: {
        contaId,
        instanciaId: id,
        ...(filters.tipo ? { tipo: filters.tipo } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    return events.map((event) => ({
      id: event.id,
      tipo: event.tipo,
      eventId: event.eventId,
      processado: event.processado,
      erro: event.erro,
      payload: event.payload,
      createdAt: event.createdAt,
      processedAt: event.processedAt,
    }));
  },

  async configureInstanceWebhooks(contaId: number, id: number, webhookUrls?: WApiWebhookUrls) {
    const instance = await getInstanceById(contaId, id);
    const urls = webhookUrls && Object.keys(webhookUrls).length ? webhookUrls : buildWebhookUrls(instance.instanceId);
    const client = new WApiClient(instance.instanceId, instance.token);
    const results = await client.configureWebhooks(urls);
    const hasFailures = results.some((result) => !result.ok && !result.skipped);

    const updated = await prisma.whatsAppInstancia.update({
      where: { id },
      data: {
        lastSyncAt: new Date(),
        ultimoErro: hasFailures ? "Uma ou mais URLs de webhook falharam ao sincronizar com a W-API" : null,
      },
    });

    sendWhatsAppInstanceUpdated(contaId, publicInstance(updated));

    return {
      instance: publicInstance(updated),
      webhookUrls: urls,
      callbacks: WAPI_WEBHOOK_ENDPOINTS.map((item) => ({
        key: item.key,
        label: item.label,
        endpoint: item.endpoint,
        url: urls[item.key],
      })),
      results,
      success: !hasFailures,
    };
  },

  async callInstanceAction(contaId: number, id: number, action: "qrCode" | "pairingCode" | "restart" | "disconnect" | "status" | "device" | "setupWebhooks", phone?: string) {
    const instance = await getInstanceById(contaId, id);
    if (action === "setupWebhooks") return this.configureInstanceWebhooks(contaId, id);

    const client = new WApiClient(instance.instanceId, instance.token);
    let result: any;

    if (action === "qrCode") result = await client.qrCode();
    if (action === "pairingCode") result = await client.pairingCode(phone || instance.numeroConectado || undefined);
    if (action === "restart") result = await client.restart();
    if (action === "disconnect") result = await client.disconnect();
    if (action === "status") result = await client.status();
    if (action === "device") result = await client.device();

    const data: Prisma.WhatsAppInstanciaUpdateInput = {
      lastSyncAt: new Date(),
      ultimoErro: null,
    };

    if (["status", "device", "qrCode", "pairingCode", "restart", "disconnect"].includes(action)) {
      data.status = action === "disconnect" ? WhatsAppInstanciaStatus.DESCONECTADA : mapWApiInstanceStatusFromPayload(result);
      if (action === "device") {
        data.devicePayload = safeJson(result);
        data.numeroConectado = normalizePhone(result?.phone || result?.number || result?.data?.phone || result?.data?.number) || instance.numeroConectado;
      }
    }

    const updated = await prisma.whatsAppInstancia.update({ where: { id }, data });
    sendWhatsAppInstanceUpdated(contaId, publicInstance(updated));
    return { result, instance: publicInstance(updated) };
  },

  async createPixPayment(
    contaId: number,
    id: number,
    input: CreateInstancePaymentInput = {}
  ) {
    const instance = await getInstanceById(contaId, id);
    const payerEmail = await getContaEmail(contaId);
    const webhookPaymentUrl =
      input.webhookPaymentUrl || buildPaymentWebhookUrl(instance.instanceId, instance.webhookSecret);
    const payload = buildWApiPaymentPayload(payerEmail, webhookPaymentUrl);
    const result = await new WApiClient(instance.instanceId, instance.token).createPixPayment(payload);
    assertWApiPaymentCreated(result, "Falha ao gerar cobranca PIX na W-API");
    const status = mapWApiPaymentStatus(result);

    const payment = await prisma.whatsAppInstanciaPagamento.create({
      data: {
        contaId,
        instanciaId: instance.id,
        metodo: "PIX",
        status,
        payerEmail,
        webhookPaymentUrl,
        paymentId: extractPaymentIdentifier(result, "paymentId"),
        qrCodeBase64: result?.qrCodeBase64 || result?.data?.qrCodeBase64 || null,
        qrCodeCopyPaste: result?.qrCodeCopyPaste || result?.data?.qrCodeCopyPaste || null,
        ticketUrl: result?.ticketUrl || result?.data?.ticketUrl || null,
        rawPayload: safeJson(result),
        pagoEm: status === "PAGO" ? new Date() : null,
      },
    });

    return publicPayment(payment);
  },

  async createCardSubscription(
    contaId: number,
    id: number,
    input: CreateInstancePaymentInput = {}
  ) {
    const instance = await getInstanceById(contaId, id);
    const payerEmail = await getContaEmail(contaId);
    const webhookPaymentUrl =
      input.webhookPaymentUrl || buildPaymentWebhookUrl(instance.instanceId, instance.webhookSecret);
    const payload = buildWApiPaymentPayload(payerEmail, webhookPaymentUrl);
    const result = await new WApiClient(instance.instanceId, instance.token).createCardSubscription(payload);
    assertWApiPaymentCreated(result, "Falha ao gerar checkout de cartao na W-API");
    const status = mapWApiPaymentStatus(result);

    const payment = await prisma.whatsAppInstanciaPagamento.create({
      data: {
        contaId,
        instanciaId: instance.id,
        metodo: "CARTAO",
        status,
        payerEmail,
        webhookPaymentUrl,
        sessionId: extractPaymentIdentifier(result, "sessionId"),
        checkoutUrl: result?.checkoutUrl || result?.data?.checkoutUrl || null,
        rawPayload: safeJson(result),
        pagoEm: status === "PAGO" ? new Date() : null,
      },
    });

    return publicPayment(payment);
  },

  async processPaymentWebhook(
    instanceId: string,
    receivedSecret: string | undefined,
    payload: any
  ) {
    const instance = await prisma.whatsAppInstancia.findUnique({ where: { instanceId } });
    if (!instance) {
      const error = new Error("Instancia de pagamento WhatsApp invalida");
      (error as any).statusCode = 404;
      throw error;
    }

    if (!receivedSecret || receivedSecret !== instance.webhookSecret) {
      const error = new Error("Assinatura de webhook de pagamento invalida");
      (error as any).statusCode = 403;
      throw error;
    }

    const paymentId = extractPaymentIdentifier(payload, "paymentId");
    const sessionId = extractPaymentIdentifier(payload, "sessionId");
    const status = mapWApiPaymentStatus(payload);
    const identifiers = [
      ...(paymentId ? [{ paymentId }] : []),
      ...(sessionId ? [{ sessionId }] : []),
    ];

    const payment = await prisma.whatsAppInstanciaPagamento.findFirst({
      where: {
        contaId: instance.contaId,
        instanciaId: instance.id,
        ...(identifiers.length ? { OR: identifiers } : { status: "PENDENTE" }),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!payment) {
      return { updated: false, status };
    }

    const updated = await prisma.whatsAppInstanciaPagamento.update({
      where: { id: payment.id },
      data: {
        status,
        paymentId: paymentId || payment.paymentId,
        sessionId: sessionId || payment.sessionId,
        rawPayload: safeJson(payload),
        pagoEm: status === "PAGO" ? new Date() : payment.pagoEm,
      },
    });

    sendWhatsAppInstanceUpdated(instance.contaId, publicInstance(instance));
    return { updated: true, payment: publicPayment(updated), status };
  },

  async listConversations(contaId: number, filters: ConversationFilters) {
    const take = Math.min(Math.max(Number(filters.take || DEFAULT_TAKE), 1), MAX_TAKE);
    const search = filters.search?.trim();
    const where: Prisma.WhatsAppConversaWhereInput = {
      contaId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.instanciaId ? { instanciaId: filters.instanciaId } : {}),
      ...(search
        ? {
            OR: [
              { telefone: { contains: normalizePhone(search) || search } },
              { Contato: { nome: { contains: search } } },
              { Cliente: { nome: { contains: search } } },
            ],
          }
        : {}),
    };

    const items = await prisma.whatsAppConversa.findMany({
      where,
      take: take + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: [{ ultimaInteracaoEm: "desc" }, { updatedAt: "desc" }],
      include: {
        Contato: true,
        Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
        Atendente: { select: { id: true, nome: true } },
        Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
      },
    });

    const hasMore = items.length > take;
    const sliced = hasMore ? items.slice(0, take) : items;
    return { items: sliced, nextCursor: hasMore ? sliced[sliced.length - 1]?.id : null };
  },

  async listMessages(contaId: number, conversaId: number, take = DEFAULT_TAKE, cursor?: number) {
    const conversa = await prisma.whatsAppConversa.findFirst({ where: { id: conversaId, contaId } });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");
    const limit = Math.min(Math.max(Number(take || DEFAULT_TAKE), 1), MAX_TAKE);
    const items = await prisma.whatsAppMensagem.findMany({
      where: { contaId, conversaId },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
    });
    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    return { items: sliced.reverse(), nextCursor: hasMore ? sliced[sliced.length - 1]?.id : null };
  },

  // Baixa e descriptografa a mídia (imagem/figurinha/vídeo/áudio/documento) de uma mensagem
  // recebida, a partir do `rawPayload` do webhook (que contém a URL `.enc` e a `mediaKey`).
  async getMessageMedia(contaId: number, messageId: number): Promise<DecryptedWhatsAppMedia> {
    const message = await prisma.whatsAppMensagem.findFirst({
      where: { id: messageId, contaId },
      select: { rawPayload: true, direcao: true, mediaUrl: true, mediaMimeType: true, fileName: true },
    });
    if (!message) {
      throw new WhatsAppMediaError("Mensagem não encontrada para esta conta.", 404);
    }

    // Mídia enviada por nós (SAIDA): já está num storage público nosso (mediaUrl). Fazemos proxy
    // server-side para servir same-origin e evitar CORS no chat do sistema (ex.: a waveform do
    // wavesurfer precisa ler os bytes do áudio, o que o bucket público bloqueia por CORS).
    if (message.direcao === WhatsAppMensagemDirecao.SAIDA && message.mediaUrl) {
      const response = await fetch(message.mediaUrl);
      if (!response.ok) {
        throw new WhatsAppMediaError(`Falha ao baixar a mídia enviada (${response.status}).`, 502);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        buffer,
        mimetype: message.mediaMimeType || response.headers.get("content-type") || "application/octet-stream",
        fileName: message.fileName || "",
      };
    }

    if (!message.rawPayload) {
      throw new WhatsAppMediaError("Mensagem sem mídia disponível para download.", 404);
    }

    let payload: any;
    try {
      payload = JSON.parse(message.rawPayload);
    } catch {
      throw new WhatsAppMediaError("Payload da mensagem inválido.", 422);
    }

    return downloadAndDecryptWhatsAppMedia(payload);
  },

  async sendMessage(contaId: number, conversaId: number, input: SendMessageInput) {
    const conversa = await prisma.whatsAppConversa.findFirst({
      where: { id: conversaId, contaId },
      include: { Instancia: true },
    });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");
    if (!conversa.Instancia.ativo) throw new Error("Instância inativa para envio de mensagens");
    if (conversa.Instancia.status !== WhatsAppInstanciaStatus.CONECTADA) throw new Error("Instância desconectada. Reconecte antes de enviar mensagens.");

    const messageId = `erp-${contaId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const tipo = input.tipo || "text";
    const prismaTipo = normalizeMessageType(tipo);

    // Ao responder, buscamos a mensagem citada para guardar um preview do conteúdo dela e já
    // exibir o trecho citado no nosso chat (o cliente respondeu a algo visível na conversa).
    const quoted = input.quotedMessageId
      ? await prisma.whatsAppMensagem.findFirst({
          where: { contaId, conversaId, externalMessageId: input.quotedMessageId },
          select: { conteudo: true, tipo: true, fileName: true },
        })
      : null;
    const quotedConteudo = quoted
      ? quoted.conteudo || (quoted.tipo === WhatsAppMensagemTipo.DOCUMENTO ? quoted.fileName || "[documento]" : `[${quoted.tipo.toLowerCase()}]`)
      : null;

    const pending = await prisma.whatsAppMensagem.create({
      data: {
        contaId,
        conversaId,
        instanciaId: conversa.instanciaId,
        direcao: WhatsAppMensagemDirecao.SAIDA,
        tipo: prismaTipo,
        externalMessageId: messageId,
        conteudo: input.conteudo || input.caption || null,
        mediaUrl: input.mediaUrl || null,
        fileName: input.fileName || null,
        quotedMessageId: input.quotedMessageId || null,
        quotedConteudo,
        statusEnvio: WhatsAppMensagemStatus.PENDENTE,
      },
    });
    sendWhatsAppMessageCreated(contaId, pending);

    try {
      const client = new WApiClient(conversa.Instancia.instanceId, conversa.Instancia.token);
      const result = await client.send(tipo as WApiMessageKind, {
        phone: conversa.telefone,
        message: input.conteudo,
        mediaUrl: input.mediaUrl,
        caption: input.caption,
        fileName: input.fileName,
        extension: input.extension,
        messageId,
        quotedMessageId: input.quotedMessageId,
      });

      const updated = await prisma.whatsAppMensagem.update({
        where: { id: pending.id },
        data: {
          rawPayload: safeJson(result),
          statusEnvio: WhatsAppMensagemStatus.ENVIADA,
          enviadoEm: new Date(),
        },
      });

      const updatedConversation = await prisma.whatsAppConversa.update({
        where: { id: conversa.id },
        data: {
          ultimaMensagem: input.conteudo || input.caption || `[${prismaTipo.toLowerCase()}]`,
          ultimaInteracaoEm: new Date(),
          // Responder move a conversa para ABERTA (em atendimento), inclusive reabrindo
          // uma que estava em ESPERA ou FINALIZADA.
          status: WhatsAppConversaStatus.ABERTA,
        },
      });
      sendWhatsAppMessageCreated(contaId, updated);
      sendWhatsAppConversationUpdated(contaId, updatedConversation);
      return updated;
    } catch (error: any) {
      const failed = await prisma.whatsAppMensagem.update({
        where: { id: pending.id },
        data: {
          statusEnvio: WhatsAppMensagemStatus.ERRO,
          erroEnvio: error?.response?.data ? safeJson(error.response.data) : error?.message || "Erro no envio pela W-API",
        },
      });
      sendWhatsAppMessageCreated(contaId, failed);
      throw error;
    }
  },

  // Envia uma localização (pino no mapa). Guarda no `rawPayload` o mesmo formato `msgContent`
  // das mensagens recebidas (locationMessage) para o frontend renderizar o balão do jeito único,
  // independente da direção.
  async sendLocationMessage(contaId: number, conversaId: number, input: SendLocationInput) {
    const conversa = await prisma.whatsAppConversa.findFirst({
      where: { id: conversaId, contaId },
      include: { Instancia: true },
    });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");
    if (!conversa.Instancia.ativo) throw new Error("Instância inativa para envio de mensagens");
    if (conversa.Instancia.status !== WhatsAppInstanciaStatus.CONECTADA) throw new Error("Instância desconectada. Reconecte antes de enviar mensagens.");

    const messageId = `erp-${contaId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const latitude = String(input.latitude);
    const longitude = String(input.longitude);
    const name = String(input.name || "").trim();
    const address = String(input.address || "").trim();
    const conteudo = `📍 ${name || "Localização"}`;
    const locationMessage = {
      degreesLatitude: Number(latitude),
      degreesLongitude: Number(longitude),
      name,
      address,
    };
    const metadata = { msgContent: { locationMessage } };

    const quoted = input.quotedMessageId
      ? await prisma.whatsAppMensagem.findFirst({
          where: { contaId, conversaId, externalMessageId: input.quotedMessageId },
          select: { conteudo: true, tipo: true, fileName: true },
        })
      : null;
    const quotedConteudo = quoted
      ? quoted.conteudo || (quoted.tipo === WhatsAppMensagemTipo.DOCUMENTO ? quoted.fileName || "[documento]" : `[${quoted.tipo.toLowerCase()}]`)
      : null;

    const pending = await prisma.whatsAppMensagem.create({
      data: {
        contaId,
        conversaId,
        instanciaId: conversa.instanciaId,
        direcao: WhatsAppMensagemDirecao.SAIDA,
        tipo: WhatsAppMensagemTipo.LOCALIZACAO,
        externalMessageId: messageId,
        conteudo,
        quotedMessageId: input.quotedMessageId || null,
        quotedConteudo,
        rawPayload: safeJson(metadata),
        statusEnvio: WhatsAppMensagemStatus.PENDENTE,
      },
    });
    sendWhatsAppMessageCreated(contaId, pending);

    try {
      const client = new WApiClient(conversa.Instancia.instanceId, conversa.Instancia.token);
      const result = await client.sendLocation({
        phone: conversa.telefone,
        latitude,
        longitude,
        name,
        address,
        quotedMessageId: input.quotedMessageId,
      });

      const updated = await prisma.whatsAppMensagem.update({
        where: { id: pending.id },
        data: {
          rawPayload: safeJson({ ...metadata, wapiResult: result }),
          statusEnvio: WhatsAppMensagemStatus.ENVIADA,
          enviadoEm: new Date(),
        },
      });
      const updatedConversation = await prisma.whatsAppConversa.update({
        where: { id: conversa.id },
        data: { ultimaMensagem: conteudo, ultimaInteracaoEm: new Date(), status: WhatsAppConversaStatus.ABERTA },
      });
      sendWhatsAppMessageCreated(contaId, updated);
      sendWhatsAppConversationUpdated(contaId, updatedConversation);
      return updated;
    } catch (error: any) {
      const failed = await prisma.whatsAppMensagem.update({
        where: { id: pending.id },
        data: {
          statusEnvio: WhatsAppMensagemStatus.ERRO,
          erroEnvio: error?.response?.data ? safeJson(error.response.data) : error?.message || "Erro no envio pela W-API",
        },
      });
      sendWhatsAppMessageCreated(contaId, failed);
      throw error;
    }
  },

  // Envia um cartão de contato (vCard). Guarda no `rawPayload` o formato `msgContent.contactMessage`
  // com o vCard montado, para o frontend renderizar o balão igual ao de um contato recebido.
  async sendContactMessage(contaId: number, conversaId: number, input: SendContactInput) {
    const conversa = await prisma.whatsAppConversa.findFirst({
      where: { id: conversaId, contaId },
      include: { Instancia: true },
    });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");
    if (!conversa.Instancia.ativo) throw new Error("Instância inativa para envio de mensagens");
    if (conversa.Instancia.status !== WhatsAppInstanciaStatus.CONECTADA) throw new Error("Instância desconectada. Reconecte antes de enviar mensagens.");

    const messageId = `erp-${contaId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const contactName = String(input.contactName || "").trim();
    const contactPhone = String(input.contactPhone || "").trim();
    const businessDescription = input.contactBusinessDescription?.trim() || undefined;
    const conteudo = `👤 ${contactName || "Contato"}`;
    const contactMessage = {
      displayName: contactName,
      vcard: buildVCard(contactName, contactPhone, businessDescription),
      phone: contactPhone,
      businessDescription: businessDescription || null,
    };
    const metadata = { msgContent: { contactMessage } };

    const quoted = input.quotedMessageId
      ? await prisma.whatsAppMensagem.findFirst({
          where: { contaId, conversaId, externalMessageId: input.quotedMessageId },
          select: { conteudo: true, tipo: true, fileName: true },
        })
      : null;
    const quotedConteudo = quoted
      ? quoted.conteudo || (quoted.tipo === WhatsAppMensagemTipo.DOCUMENTO ? quoted.fileName || "[documento]" : `[${quoted.tipo.toLowerCase()}]`)
      : null;

    const pending = await prisma.whatsAppMensagem.create({
      data: {
        contaId,
        conversaId,
        instanciaId: conversa.instanciaId,
        direcao: WhatsAppMensagemDirecao.SAIDA,
        tipo: WhatsAppMensagemTipo.CONTATO,
        externalMessageId: messageId,
        conteudo,
        quotedMessageId: input.quotedMessageId || null,
        quotedConteudo,
        rawPayload: safeJson(metadata),
        statusEnvio: WhatsAppMensagemStatus.PENDENTE,
      },
    });
    sendWhatsAppMessageCreated(contaId, pending);

    try {
      const client = new WApiClient(conversa.Instancia.instanceId, conversa.Instancia.token);
      const result = await client.sendContact({
        phone: conversa.telefone,
        contactName,
        contactPhone,
        contactBusinessDescription: businessDescription,
        quotedMessageId: input.quotedMessageId,
      });

      const updated = await prisma.whatsAppMensagem.update({
        where: { id: pending.id },
        data: {
          rawPayload: safeJson({ ...metadata, wapiResult: result }),
          statusEnvio: WhatsAppMensagemStatus.ENVIADA,
          enviadoEm: new Date(),
        },
      });
      const updatedConversation = await prisma.whatsAppConversa.update({
        where: { id: conversa.id },
        data: { ultimaMensagem: conteudo, ultimaInteracaoEm: new Date(), status: WhatsAppConversaStatus.ABERTA },
      });
      sendWhatsAppMessageCreated(contaId, updated);
      sendWhatsAppConversationUpdated(contaId, updatedConversation);
      return updated;
    } catch (error: any) {
      const failed = await prisma.whatsAppMensagem.update({
        where: { id: pending.id },
        data: {
          statusEnvio: WhatsAppMensagemStatus.ERRO,
          erroEnvio: error?.response?.data ? safeJson(error.response.data) : error?.message || "Erro no envio pela W-API",
        },
      });
      sendWhatsAppMessageCreated(contaId, failed);
      throw error;
    }
  },

  // Envia uma imagem vinda do dispositivo do usuário: reescala/comprime (scale down), salva no
  // storage público (Cloudflare R2) e envia a URL pública ao destino reaproveitando `sendMessage`.
  async sendImageMessage(
    contaId: number,
    conversaId: number,
    input: { buffer: Buffer; mimeType?: string | null; originalName?: string | null; caption?: string; quotedMessageId?: string },
  ) {
    const conversa = await prisma.whatsAppConversa.findFirst({ where: { id: conversaId, contaId } });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");

    // Scale down obrigatório para qualquer imagem enviada.
    const processed = await downscaleImage(input.buffer, input.mimeType);

    const fileName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${processed.extension}`;
    const key = buildScopedUploadKey(contaId, `whatsapp/conversas/${conversaId}`, fileName);
    const uploaded = await uploadPublicFile({ key, body: processed.buffer, contentType: processed.contentType });

    // Bucket público: a URL já é acessível diretamente, sem presign.
    return this.sendMessage(contaId, conversaId, {
      tipo: "image",
      mediaUrl: uploaded.url,
      caption: input.caption,
      quotedMessageId: input.quotedMessageId,
    });
  },

  // Envia um áudio gravado no dispositivo: transcoda para OGG/Opus (ffmpeg), salva no storage
  // público (Cloudflare R2) e envia a URL ao destino como nota de voz, reaproveitando `sendMessage`.
  async sendAudioMessage(
    contaId: number,
    conversaId: number,
    input: { buffer: Buffer; mimeType?: string | null; quotedMessageId?: string },
  ) {
    const conversa = await prisma.whatsAppConversa.findFirst({ where: { id: conversaId, contaId } });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");

    const audio = await transcodeAudioToOgg(input.buffer, input.mimeType);

    const fileName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${audio.extension}`;
    const key = buildScopedUploadKey(contaId, `whatsapp/conversas/${conversaId}`, fileName);
    const uploaded = await uploadPublicFile({ key, body: audio.buffer, contentType: audio.contentType });

    return this.sendMessage(contaId, conversaId, {
      tipo: "audio",
      mediaUrl: uploaded.url,
      quotedMessageId: input.quotedMessageId,
    });
  },

  async updateConversation(contaId: number, conversaId: number, input: { status?: WhatsAppConversaStatus; atendenteId?: number | null; setor?: string | null; fila?: string | null; clienteId?: number | null }) {
    const conversa = await prisma.whatsAppConversa.findFirst({ where: { id: conversaId, contaId } });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");

    if (input.atendenteId) {
      const user = await prisma.usuarios.findFirst({ where: { id: input.atendenteId, contaId } });
      if (!user) throw new Error("Atendente não encontrado para esta conta");
    }

    if (input.clienteId) {
      const cliente = await prisma.clientesFornecedores.findFirst({ where: { id: input.clienteId, contaId } });
      if (!cliente) throw new Error("Cliente não encontrado para esta conta");
      await prisma.whatsAppContato.update({ where: { id: conversa.contatoId }, data: { clienteId: input.clienteId } });
    }

    const updated = await prisma.whatsAppConversa.update({
      where: { id: conversaId },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...("atendenteId" in input ? { atendenteId: input.atendenteId } : {}),
        ...("setor" in input ? { setor: input.setor } : {}),
        ...("fila" in input ? { fila: input.fila } : {}),
        ...("clienteId" in input ? { clienteId: input.clienteId } : {}),
      },
      include: {
        Contato: true,
        Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
        Atendente: { select: { id: true, nome: true } },
        Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
      },
    });
    sendWhatsAppConversationUpdated(contaId, updated);
    return updated;
  },

  // Apaga um chat (conversa + suas mensagens). Ação restrita a administradores no controller.
  // O contato é preservado (permanece na lista de contatos, podendo ser vinculado a um cliente).
  async removeConversation(contaId: number, conversaId: number) {
    const conversa = await prisma.whatsAppConversa.findFirst({ where: { id: conversaId, contaId } });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");

    await prisma.$transaction([
      prisma.whatsAppMensagem.deleteMany({ where: { contaId, conversaId } }),
      // Apaga os webhooks correspondentes ao chat (mesmo telefone + instância) para não acumular.
      prisma.whatsAppWebhookEvento.deleteMany({
        where: { contaId, instanciaId: conversa.instanciaId, telefone: conversa.telefone },
      }),
      prisma.whatsAppConversa.delete({ where: { id: conversaId } }),
    ]);

    sendWhatsAppConversationDeleted(contaId, { id: conversaId });
    return { id: conversaId };
  },

  // Lista de contatos (tabela WhatsAppContato): contatos podem ou não estar vinculados a um
  // cliente do ERP; um mesmo cliente pode ter vários contatos. Se vinculado, o chat mostra o
  // nome do cliente; senão, o nome salvo no contato.
  async listContacts(contaId: number, filters: { search?: string; take?: number; cursor?: number } = {}) {
    const take = Math.min(Math.max(Number(filters.take || DEFAULT_TAKE), 1), MAX_TAKE);
    const search = filters.search?.trim();
    const where: Prisma.WhatsAppContatoWhereInput = {
      contaId,
      ...(search
        ? {
            OR: [
              { nome: { contains: search } },
              { telefone: { contains: normalizePhone(search) || search } },
              { Cliente: { nome: { contains: search } } },
            ],
          }
        : {}),
    };

    const items = await prisma.whatsAppContato.findMany({
      where,
      take: take + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: { updatedAt: "desc" },
      include: {
        Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
        _count: { select: { conversas: true } },
      },
    });

    const hasMore = items.length > take;
    const sliced = hasMore ? items.slice(0, take) : items;
    return {
      items: sliced.map((contato) => {
        const { dadosAuxiliares: _dadosAuxiliares, ...rest } = contato as any;
        return rest;
      }),
      nextCursor: hasMore ? sliced[sliced.length - 1]?.id : null,
    };
  },

  // Lista de contatos no formato select2 ({ id, label }) para o componente Select2Ajax.
  // Suporta busca por nome/telefone/cliente e resolução de um id específico (item selecionado).
  async select2Contacts(contaId: number, filters: { search?: string; id?: number } = {}) {
    if (filters.id) {
      const contato = await prisma.whatsAppContato.findFirst({ where: { id: filters.id, contaId } });
      if (!contato) return [];
      return [{ id: contato.id, label: contato.nome ? `${contato.nome} · ${contato.telefone}` : contato.telefone }];
    }

    const search = filters.search?.trim();
    const where: Prisma.WhatsAppContatoWhereInput = {
      contaId,
      ...(search
        ? {
            OR: [
              { nome: { contains: search } },
              { telefone: { contains: normalizePhone(search) || search } },
              { Cliente: { nome: { contains: search } } },
            ],
          }
        : {}),
    };

    const contatos = await prisma.whatsAppContato.findMany({
      where,
      take: 20,
      orderBy: { updatedAt: "desc" },
    });
    return contatos.map((contato) => ({
      id: contato.id,
      label: contato.nome ? `${contato.nome} · ${contato.telefone}` : contato.telefone,
    }));
  },

  // Atualiza um contato: renomear e/ou (des)vincular a um cliente. Ao (des)vincular, propaga o
  // clienteId para as conversas desse contato, para o chat refletir o nome correto.
  async updateContact(contaId: number, contatoId: number, input: { nome?: string | null; clienteId?: number | null }) {
    const contato = await prisma.whatsAppContato.findFirst({ where: { id: contatoId, contaId } });
    if (!contato) throw new Error("Contato não encontrado para esta conta");

    if (input.clienteId) {
      const cliente = await prisma.clientesFornecedores.findFirst({ where: { id: input.clienteId, contaId } });
      if (!cliente) throw new Error("Cliente não encontrado para esta conta");
    }

    const data: Prisma.WhatsAppContatoUpdateInput = {};
    if ("nome" in input) {
      // Editar o nome fixa-o como manual: a partir daqui os webhooks não o sobrescrevem.
      data.nome = input.nome?.trim() || null;
      data.nomeManual = Boolean(data.nome);
    }
    if ("clienteId" in input) {
      data.Cliente = input.clienteId ? { connect: { id: input.clienteId } } : { disconnect: true };
    }

    const updated = await prisma.whatsAppContato.update({
      where: { id: contatoId },
      data,
      include: {
        Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
        _count: { select: { conversas: true } },
      },
    });

    if ("clienteId" in input) {
      await prisma.whatsAppConversa.updateMany({
        where: { contaId, contatoId },
        data: { clienteId: input.clienteId ?? null },
      });
      // Notifica os clientes para recarregarem as conversas afetadas (rótulo/cliente mudou).
      const conversas = await prisma.whatsAppConversa.findMany({
        where: { contaId, contatoId },
        include: {
          Contato: true,
          Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
          Atendente: { select: { id: true, nome: true } },
          Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
        },
      });
      conversas.forEach((conversa) => sendWhatsAppConversationUpdated(contaId, conversa));
    }

    const { dadosAuxiliares: _dadosAuxiliares, ...rest } = updated as any;
    return rest;
  },

  // Apaga um contato e, junto, todas as conversas e mensagens dele (a conversa tem FK Restrict
  // para o contato). Ação restrita a administradores no controller.
  async removeContact(contaId: number, contatoId: number) {
    const contato = await prisma.whatsAppContato.findFirst({ where: { id: contatoId, contaId } });
    if (!contato) throw new Error("Contato não encontrado para esta conta");

    const conversas = await prisma.whatsAppConversa.findMany({
      where: { contaId, contatoId },
      select: { id: true },
    });
    const conversaIds = conversas.map((conversa) => conversa.id);

    await prisma.$transaction([
      ...(conversaIds.length
        ? [
            prisma.whatsAppMensagem.deleteMany({ where: { contaId, conversaId: { in: conversaIds } } }),
            prisma.whatsAppConversa.deleteMany({ where: { contaId, contatoId } }),
          ]
        : []),
      // Apaga os webhooks correspondentes ao contato (mesmo telefone) para não acumular.
      prisma.whatsAppWebhookEvento.deleteMany({ where: { contaId, telefone: contato.telefone } }),
      prisma.whatsAppContato.delete({ where: { id: contatoId } }),
    ]);

    conversaIds.forEach((id) => sendWhatsAppConversationDeleted(contaId, { id }));
    sendWhatsAppContactDeleted(contaId, { id: contatoId });
    return { id: contatoId, conversasRemovidas: conversaIds.length };
  },

  async markAsRead(contaId: number, conversaId: number) {
    const conversa = await prisma.whatsAppConversa.findFirst({
      where: { id: conversaId, contaId },
      include: { Instancia: true },
    });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");

    await prisma.whatsAppMensagem.updateMany({
      where: { contaId, conversaId, direcao: WhatsAppMensagemDirecao.ENTRADA, lidoEm: null },
      data: { lidoEm: new Date(), statusEnvio: WhatsAppMensagemStatus.LIDA },
    });
    const updated = await prisma.whatsAppConversa.update({ where: { id: conversaId }, data: { naoLidas: 0 } });

    try {
      const lastUnread = await prisma.whatsAppMensagem.findFirst({
        where: { contaId, conversaId, direcao: WhatsAppMensagemDirecao.ENTRADA },
        orderBy: { createdAt: "desc" },
      });
      if (lastUnread) {
        await new WApiClient(conversa.Instancia.instanceId, conversa.Instancia.token).readMessage(conversa.telefone, lastUnread.externalMessageId);
      }
    } catch (error) {
      console.warn(`[whatsapp] Falha ao sinalizar leitura na W-API conversa=${conversaId}`, error);
    }

    sendWhatsAppConversationUpdated(contaId, updated);
    return updated;
  },

  // Assume o atendimento: registra o atendente responsável e move a conversa de ESPERA
  // (PENDENTE) para ABERTA (em atendimento). É a ação explícita de "Atender" — clicar/abrir
  // a conversa não inicia o atendimento, o que mantém os KPIs de quem atendeu confiáveis.
  async attendConversation(contaId: number, conversaId: number, atendenteId: number) {
    const conversa = await prisma.whatsAppConversa.findFirst({ where: { id: conversaId, contaId } });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");

    const updated = await prisma.whatsAppConversa.update({
      where: { id: conversaId },
      data: {
        status: WhatsAppConversaStatus.ABERTA,
        atendenteId,
      },
      include: {
        Contato: true,
        Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
        Atendente: { select: { id: true, nome: true } },
        Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
      },
    });

    sendWhatsAppConversationUpdated(contaId, updated);
    return updated;
  },

  // Ferramenta de ação rápida "Venda": lista as vendas do cliente vinculado à conversa.
  // Exige que o contato esteja vinculado a um cliente do sistema e só retorna vendas desse cliente.
  async listConversationSales(contaId: number, conversaId: number, search?: string) {
    const conversa = await prisma.whatsAppConversa.findFirst({
      where: { id: conversaId, contaId },
      select: { clienteId: true, Cliente: { select: { id: true, nome: true } } },
    });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");
    if (!conversa.clienteId) {
      throw new Error("Vincule um cliente do sistema à conversa para usar a ferramenta de venda.");
    }

    const term = search?.trim();
    const vendas = await prisma.vendas.findMany({
      where: {
        contaId,
        clienteId: conversa.clienteId,
        ...(term ? { Uid: { contains: term } } : {}),
      },
      orderBy: { data: "desc" },
      take: 20,
      select: { id: true, Uid: true, data: true, status: true, valor: true, desconto: true },
    });

    return {
      cliente: conversa.Cliente,
      items: vendas.map((venda) => ({
        id: venda.id,
        uid: venda.Uid,
        data: venda.data,
        status: venda.status,
        total: Math.max(0, Number(venda.valor || 0) - Number(venda.desconto || 0)),
      })),
    };
  },

  // Envia o resumo de uma venda do cliente vinculado para a conversa (persiste na thread e
  // dispara pela instância da conversa, reaproveitando `sendMessage`).
  async sendConversationSale(contaId: number, conversaId: number, vendaId: number) {
    const conversa = await prisma.whatsAppConversa.findFirst({
      where: { id: conversaId, contaId },
      select: { clienteId: true, Cliente: { select: { id: true, nome: true } } },
    });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");
    if (!conversa.clienteId) {
      throw new Error("Vincule um cliente do sistema à conversa para enviar dados de venda.");
    }

    const venda = await prisma.vendas.findFirst({
      where: { id: vendaId, contaId, clienteId: conversa.clienteId },
      include: {
        ItensVendas: {
          include: {
            produto: { select: { nome: true } },
            servico: { select: { nome: true } },
          },
        },
        PagamentoVendas: true,
      },
    });
    if (!venda) throw new Error("Venda não encontrada para o cliente desta conversa.");

    const message = buildVendaResumoMessage(venda, conversa.Cliente?.nome || "cliente");
    return this.sendMessage(contaId, conversaId, { tipo: "text", conteudo: message });
  },

  async startConversation(contaId: number, input: { clienteId?: number; contatoId?: number; phone?: string; nome?: string; instanciaId?: number }) {
    // A nova conversa pode partir de um contato já existente (WhatsAppContato) ou de um cliente
    // do ERP com telefone/WhatsApp cadastrado. Em ambos os casos resolvemos o `contato` e o
    // telefone antes de criar/reaproveitar a conversa.
    let contato: { id: number; telefone: string; clienteId: number | null };
    let clienteId: number | null = null;

    if (input.contatoId) {
      const found = await prisma.whatsAppContato.findFirst({
        where: { id: input.contatoId, contaId },
        select: { id: true, telefone: true, clienteId: true },
      });
      if (!found) throw new Error("Contato não encontrado para esta conta");
      contato = found;
      clienteId = found.clienteId ?? null;
    } else if (input.clienteId) {
      const cliente = await prisma.clientesFornecedores.findFirst({
        where: { id: input.clienteId, contaId },
        select: { id: true, nome: true, telefone: true, whastapp: true },
      });
      if (!cliente) throw new Error("Cliente não encontrado para esta conta");

      const clientePhone = normalizePhone(cliente.whastapp || cliente.telefone);
      if (!clientePhone) throw new Error("Cliente não possui telefone/WhatsApp cadastrado para iniciar o atendimento");

      contato = await prisma.whatsAppContato.upsert({
        where: { contaId_telefone: { contaId, telefone: clientePhone } },
        update: { nome: cliente.nome || undefined, clienteId: cliente.id },
        create: {
          contaId,
          telefone: clientePhone,
          nome: cliente.nome || null,
          clienteId: cliente.id,
          dadosAuxiliares: safeJson({ createdBy: "atendimento-start" }),
        },
        select: { id: true, telefone: true, clienteId: true },
      });
      clienteId = cliente.id;
    } else if (input.phone) {
      // Telefone avulso (ex.: "Conversar" no cartão de contato recebido): cria/reaproveita um
      // WhatsAppContato com esse número para abrir o atendimento no sistema.
      const phoneNorm = normalizePhone(input.phone);
      if (!phoneNorm) throw new Error("Telefone inválido para iniciar o atendimento");

      contato = await prisma.whatsAppContato.upsert({
        where: { contaId_telefone: { contaId, telefone: phoneNorm } },
        update: { nome: input.nome?.trim() || undefined },
        create: {
          contaId,
          telefone: phoneNorm,
          nome: input.nome?.trim() || null,
          dadosAuxiliares: safeJson({ createdBy: "atendimento-contact-card" }),
        },
        select: { id: true, telefone: true, clienteId: true },
      });
      clienteId = contato.clienteId ?? null;
    } else {
      throw new Error("Informe um cliente, contato ou telefone para iniciar a conversa");
    }

    const phone = normalizePhone(contato.telefone);
    if (!phone) throw new Error("Contato não possui telefone válido para iniciar o atendimento");

    let instance;
    if (input.instanciaId) {
      instance = await prisma.whatsAppInstancia.findFirst({ where: { id: input.instanciaId, contaId, ativo: true } });
      if (!instance) throw new Error("Instância de WhatsApp não encontrada para esta conta");
    } else {
      instance =
        (await prisma.whatsAppInstancia.findFirst({
          where: { contaId, ativo: true, status: WhatsAppInstanciaStatus.CONECTADA },
          orderBy: { updatedAt: "desc" },
        })) ||
        (await prisma.whatsAppInstancia.findFirst({
          where: { contaId, ativo: true },
          orderBy: { updatedAt: "desc" },
        }));
      if (!instance) throw new Error("Nenhuma instância de WhatsApp ativa. Conecte uma instância no app WhatsApp antes de iniciar o atendimento.");
    }

    const conversa = await prisma.whatsAppConversa.upsert({
      where: {
        contaId_instanciaId_telefone: { contaId, instanciaId: instance.id, telefone: phone },
      },
      update: {
        contatoId: contato.id,
        clienteId: clienteId ?? undefined,
        status: WhatsAppConversaStatus.ABERTA,
      },
      create: {
        contaId,
        instanciaId: instance.id,
        contatoId: contato.id,
        clienteId,
        telefone: phone,
        status: WhatsAppConversaStatus.ABERTA,
        ultimaInteracaoEm: new Date(),
        naoLidas: 0,
      },
      include: {
        Contato: true,
        Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
        Atendente: { select: { id: true, nome: true } },
        Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
      },
    });

    sendWhatsAppConversationUpdated(contaId, conversa);
    return conversa;
  },

  async processWebhook(instanceId: string, explicitKind: WhatsAppWebhookKind, payload: any) {
    const instance = await prisma.whatsAppInstancia.findUnique({ where: { instanceId } });
    if (!instance || !instance.ativo) {
      const error = new Error("Instância de webhook inválida ou inativa");
      (error as any).statusCode = 404;
      throw error;
    }

    // A W-API não repassa o segredo ao chamar o webhook, então a instância é identificada
    // apenas pelo `instanceId` na rota; não há validação de segredo aqui.
    const eventId = String(payload?.eventId || payload?.id || payload?.data?.id || payload?.messageId || payload?.data?.messageId || hashPayload(payload));
    const tipo = String(explicitKind || payload?.event || payload?.type || payload?.eventName || "generic");

    // "Não perturbe" / fora do horário de atendimento: sem desconectar a API, ignoramos os eventos
    // de mensagem recebida — não registramos o evento nem criamos contato/conversa/mensagem.
    // Eventos de conexão (connected/disconnected/status) e recibos de entrega (delivery) seguem
    // normais, para o status da instância continuar correto.
    const inboundMessageEvent =
      tipo === "received" || Boolean(payload?.msgContent || payload?.message || payload?.data?.message);
    if (inboundMessageEvent && tipo !== "delivery" && instanceAtendimentoPaused(instance)) {
      return { ignored: true, reason: "atendimento-pausado" as const };
    }

    let event = await prisma.whatsAppWebhookEvento.findUnique({
      where: { instanciaId_eventId: { instanciaId: instance.id, eventId } },
    });

    if (event?.processado) {
      return { duplicated: true, event };
    }

    if (!event) {
      event = await prisma.whatsAppWebhookEvento.create({
        data: {
          contaId: instance.contaId,
          instanciaId: instance.id,
          eventId,
          tipo,
          payload: safeJson(payload),
        },
      });
    }

    try {
      // Telefone do chat a que este evento pertence (quando é evento de mensagem). Guardado no
      // registro do evento para permitir apagar os webhooks correspondentes ao excluir o chat.
      let eventTelefone: string | null = null;
      // Só eventos que refletem de fato a conexão alteram o status da instância:
      // - `connected`/`disconnected`: sinais explícitos da W-API;
      // - `status`: aplicado apenas quando o payload traz um estado conclusivo — nunca
      //   rebaixamos para PENDENTE por payload ambíguo;
      // - `presence` (presença do contato no chat: online/digitando) NÃO diz respeito à
      //   conexão da instância e por isso nunca mexe no status. Antes ele caía no fallback
      //   "PENDENTE" de mapWApiInstanceStatusFromPayload e derrubava uma instância conectada
      //   a cada evento de presença.
      // Além disso, qualquer mensagem realmente recebida prova que a instância está
      // conectada: se estava PENDENTE/CONECTANDO, reconhece como CONECTADA.
      let nextInstanceStatus: WhatsAppInstanciaStatus | null = null;
      if (tipo === "connected") {
        nextInstanceStatus = WhatsAppInstanciaStatus.CONECTADA;
      } else if (tipo === "disconnected") {
        nextInstanceStatus = WhatsAppInstanciaStatus.DESCONECTADA;
      } else if (tipo === "status") {
        const mapped = mapWApiInstanceStatusFromPayload(payload);
        if (mapped !== "PENDENTE") {
          nextInstanceStatus = mapped as WhatsAppInstanciaStatus;
        }
      } else if (
        tipo === "received" &&
        (instance.status === WhatsAppInstanciaStatus.PENDENTE ||
          instance.status === WhatsAppInstanciaStatus.CONECTANDO)
      ) {
        nextInstanceStatus = WhatsAppInstanciaStatus.CONECTADA;
      }

      if (nextInstanceStatus && nextInstanceStatus !== instance.status) {
        const updatedInstance = await prisma.whatsAppInstancia.update({
          where: { id: instance.id },
          data: { status: nextInstanceStatus, lastSyncAt: new Date(), ultimoErro: null },
        });
        sendWhatsAppInstanceUpdated(instance.contaId, publicInstance(updatedInstance));
      }

      if (["received", "delivery"].includes(tipo) || payload?.msgContent || payload?.message || payload?.data?.message || payload?.data?.messageId) {
        if (tipo === "delivery" || payload?.status || payload?.data?.status || payload?.ack || payload?.data?.ack) {
          const messageId = String(payload?.messageId || payload?.data?.messageId || payload?.id || payload?.data?.id || "");
          if (messageId) {
            await prisma.whatsAppMensagem.updateMany({
              where: { contaId: instance.contaId, instanciaId: instance.id, externalMessageId: messageId },
              data: { statusEnvio: mapMessageStatus(payload), ...(mapMessageStatus(payload) === WhatsAppMensagemStatus.LIDA ? { lidoEm: new Date() } : {}) },
            });
          }
        }

        if (tipo !== "delivery") {
          // Evento de exclusão (protocolMessage REVOKE): o remetente apagou a mensagem. Não
          // criamos um balão novo (que aparecia como "Mídia"); apenas marcamos a mensagem
          // original referenciada (`key.ID`) como apagada para exibir a badge no chat.
          const protocolMessage =
            payload?.msgContent?.protocolMessage || payload?.message?.protocolMessage || payload?.data?.message?.protocolMessage;
          const reactionMessage =
            payload?.msgContent?.reactionMessage || payload?.message?.reactionMessage || payload?.data?.message?.reactionMessage;
          const msg = extractMessagePayload(payload);
          // Vincula o evento ao chat pelo telefone (mesmo valor de conversa.telefone/contato.telefone).
          if (msg.phone && !msg.isGroup && !msg.isStatusBroadcast && !msg.isChannel) eventTelefone = msg.phone;
          if (reactionMessage) {
            await applyReaction(instance, payload, reactionMessage);
          } else if (protocolMessage?.type === "REVOKE") {
            const revokedId = String(protocolMessage?.key?.ID || protocolMessage?.key?.id || "");
            if (revokedId) {
              await prisma.whatsAppMensagem.updateMany({
                where: { contaId: instance.contaId, instanciaId: instance.id, externalMessageId: revokedId, apagadaEm: null },
                data: { apagadaEm: new Date() },
              });
              const revoked = await prisma.whatsAppMensagem.findFirst({
                where: { contaId: instance.contaId, instanciaId: instance.id, externalMessageId: revokedId },
              });
              if (revoked) sendWhatsAppMessageCreated(instance.contaId, revoked);
            }
          } else if (msg.phone && !msg.isGroup && !msg.isStatusBroadcast && !msg.isChannel) {
            const autoCliente = await findAutoCliente(instance.contaId, msg.phone);
            const existingContato = await prisma.whatsAppContato.findUnique({
              where: { contaId_telefone: { contaId: instance.contaId, telefone: msg.phone } },
              select: { nomeManual: true },
            });
            const contato = await prisma.whatsAppContato.upsert({
              where: { contaId_telefone: { contaId: instance.contaId, telefone: msg.phone } },
              update: {
                // Nome definido manualmente pelo usuário não é sobrescrito pelo pushName do evento.
                ...(existingContato?.nomeManual ? {} : { nome: msg.pushName || undefined }),
                foto: msg.foto || undefined,
                clienteId: autoCliente?.id || undefined,
                dadosAuxiliares: safeJson({ lastWebhookAt: new Date().toISOString() }),
              },
              create: {
                contaId: instance.contaId,
                telefone: msg.phone,
                nome: msg.pushName || null,
                foto: msg.foto || null,
                clienteId: autoCliente?.id || null,
                dadosAuxiliares: safeJson({ createdBy: "whatsapp-webhook" }),
              },
            });

            const existingConversa = await prisma.whatsAppConversa.findUnique({
              where: {
                contaId_instanciaId_telefone: {
                  contaId: instance.contaId,
                  instanciaId: instance.id,
                  telefone: msg.phone,
                },
              },
              select: { status: true },
            });

            // Fluxo de atendimento (ESPERA -> ABERTA -> FINALIZADA): mensagem recebida do
            // cliente coloca/mantém a conversa em ESPERA (PENDENTE) até alguém assumir; se já
            // estiver ABERTA (em atendimento) permanece ABERTA. Uma mensagem enviada (fromMe)
            // marca ABERTA. Conversa FINALIZADA que recebe nova mensagem volta para ESPERA.
            const nextConversaStatus = msg.fromMe
              ? WhatsAppConversaStatus.ABERTA
              : existingConversa?.status === WhatsAppConversaStatus.ABERTA
                ? WhatsAppConversaStatus.ABERTA
                : WhatsAppConversaStatus.PENDENTE;

            const conversa = await prisma.whatsAppConversa.upsert({
              where: {
                contaId_instanciaId_telefone: {
                  contaId: instance.contaId,
                  instanciaId: instance.id,
                  telefone: msg.phone,
                },
              },
              update: {
                contatoId: contato.id,
                clienteId: contato.clienteId || autoCliente?.id || undefined,
                status: nextConversaStatus,
                ultimaMensagem: msg.conteudo || `[${msg.tipo.toLowerCase()}]`,
                ultimaInteracaoEm: new Date(),
                ...(msg.fromMe ? {} : { naoLidas: { increment: 1 } }),
              },
              create: {
                contaId: instance.contaId,
                instanciaId: instance.id,
                contatoId: contato.id,
                clienteId: contato.clienteId || autoCliente?.id || null,
                telefone: msg.phone,
                status: nextConversaStatus,
                ultimaMensagem: msg.conteudo || `[${msg.tipo.toLowerCase()}]`,
                ultimaInteracaoEm: new Date(),
                naoLidas: msg.fromMe ? 0 : 1,
              },
              include: {
                Contato: true,
                Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
                Atendente: { select: { id: true, nome: true } },
                Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
              },
            });

            const message = await prisma.whatsAppMensagem.upsert({
              where: {
                contaId_instanciaId_externalMessageId: {
                  contaId: instance.contaId,
                  instanciaId: instance.id,
                  externalMessageId: msg.externalMessageId,
                },
              },
              update: { rawPayload: safeJson(payload) },
              create: {
                contaId: instance.contaId,
                conversaId: conversa.id,
                instanciaId: instance.id,
                direcao: msg.fromMe ? WhatsAppMensagemDirecao.SAIDA : WhatsAppMensagemDirecao.ENTRADA,
                tipo: msg.tipo,
                externalMessageId: msg.externalMessageId,
                conteudo: msg.conteudo || null,
                mediaUrl: msg.mediaUrl || null,
                mediaMimeType: msg.mediaMimeType || null,
                fileName: msg.fileName || null,
                quotedMessageId: msg.quotedMessageId || null,
                quotedConteudo: msg.quotedConteudo || null,
                rawPayload: safeJson(payload),
                statusEnvio: msg.fromMe ? WhatsAppMensagemStatus.ENVIADA : WhatsAppMensagemStatus.RECEBIDA,
                enviadoEm: msg.fromMe ? new Date() : null,
              },
            });

            sendWhatsAppConversationUpdated(instance.contaId, conversa);
            sendWhatsAppMessageCreated(instance.contaId, message);

            // Autoatendimento por agente de IA: só para mensagens recebidas do cliente.
            // Roda em background para não segurar a resposta do webhook.
            if (!msg.fromMe) {
              void whatsAppAgentService.handleIncomingForAgent({
                contaId: instance.contaId,
                instance: { id: instance.id, instanceId: instance.instanceId, token: instance.token },
                conversa: {
                  id: conversa.id,
                  telefone: conversa.telefone,
                  status: conversa.status,
                  atendenteId: conversa.atendenteId ?? null,
                },
                incoming: { conteudo: msg.conteudo, tipo: msg.tipo },
                incomingMessageId: message.id,
                payload,
              });
            }
          }
        }
      }

      const processed = await prisma.whatsAppWebhookEvento.update({
        where: { id: event.id },
        data: { processado: true, processedAt: new Date(), erro: null, telefone: eventTelefone },
      });
      return { duplicated: false, event: processed };
    } catch (error: any) {
      await prisma.whatsAppWebhookEvento.update({
        where: { id: event.id },
        data: { erro: error?.message || "Erro ao processar webhook" },
      });
      await prisma.whatsAppInstancia.update({
        where: { id: instance.id },
        data: { ultimoErro: error?.message || "Erro ao processar webhook", lastSyncAt: new Date() },
      });
      throw error;
    }
  },
};
