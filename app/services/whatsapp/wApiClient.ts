import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { env } from "../../utils/dotenv";

export type WApiMessageKind = "text" | "image" | "audio" | "video" | "document";
export type WApiWebhookKey = "connected" | "disconnected" | "delivery" | "received" | "status" | "presence";

// Endpoints reais da W-API para registrar as URLs de webhook por evento.
// IMPORTANTE: o caminho correto é `/v1/webhook/update-webhook-*` (não `/v1/instance/...`);
// `status` usa o sufixo `message-status` e `presence` usa `chat-presence`. Endpoints errados
// fazem o PUT retornar 404 e a W-API nunca passa a enviar os eventos recebidos.
export const WAPI_WEBHOOK_ENDPOINTS: Array<{ key: WApiWebhookKey; label: string; endpoint: string }> = [
  { key: "connected", label: "Ao conectar", endpoint: "/v1/webhook/update-webhook-connected" },
  { key: "disconnected", label: "Ao desconectar", endpoint: "/v1/webhook/update-webhook-disconnected" },
  { key: "delivery", label: "Ao enviar", endpoint: "/v1/webhook/update-webhook-delivery" },
  { key: "received", label: "Ao receber", endpoint: "/v1/webhook/update-webhook-received" },
  { key: "status", label: "Status de mensagens", endpoint: "/v1/webhook/update-webhook-message-status" },
  { key: "presence", label: "Status do chat", endpoint: "/v1/webhook/update-webhook-chat-presence" },
];

export type WApiWebhookUrls = Partial<Record<WApiWebhookKey, string>>;

export function wApiMessageIdFromResponse(response: any): string {
  return String(
    response?.messageId ||
    response?.data?.messageId ||
    response?.wapiResult?.messageId ||
    response?.wapiResult?.data?.messageId ||
    "",
  );
}

/**
 * A W-API pode responder HTTP 2xx para uma solicitação recusada. Não considerar essa
 * resposta como envio aceito é essencial para que a fila aplique o retry.
 */
export function wApiSendAccepted(response: any): boolean {
  const payload = response?.data && typeof response.data === "object" ? response.data : response;
  if (!payload || typeof payload !== "object") return false;
  const status = String(payload?.status || payload?.state || "").toLowerCase();
  return !(
    payload?.error === true ||
    payload?.success === false ||
    payload?.ok === false ||
    ["error", "failed", "failure", "rejected"].includes(status)
  );
}

function assertWApiSuccess(response: any): void {
  if (wApiSendAccepted(response)) return;
  const payload = response?.data && typeof response.data === "object" ? response.data : response;
  throw new Error(payload?.message || "Solicitação recusada pela W-API");
}

export interface WApiSendMessageInput {
  phone: string;
  message?: string;
  mediaUrl?: string;
  caption?: string;
  fileName?: string;
  extension?: string;
  // Identificador local de rastreio, não enviado à W-API.
  messageId: string;
  // Id externo da mensagem citada, enviado como `messageId` (citação).
  quotedMessageId?: string;
}

export interface WApiSendLocationInput {
  phone: string;
  latitude: string;
  longitude: string;
  name: string;
  address: string;
  // Id externo da mensagem citada (quando o envio é uma resposta).
  quotedMessageId?: string;
}

export interface WApiSendContactInput {
  phone: string;
  contactName: string;
  contactPhone: string;
  contactBusinessDescription?: string;
  quotedMessageId?: string;
}

export interface WApiPaymentInput {
  payerEmail: string;
  webhookPaymentUrl?: string;
}

export interface WApiCreateInstanceInput {
  apiKey: string;
  instanceName: string;
}

export interface WApiCreateInstanceResult {
  error?: boolean;
  message?: string;
  instanceId?: string;
  token?: string;
  instanceName?: string;
  isTrial?: boolean;
  status?: string;
}

export class WApiClient {
  private readonly http: AxiosInstance;
  private readonly instanceId: string;

  // Provisiona uma instância nova a nível de conta (não usa Bearer nem instanceId: a
  // autenticação vai no corpo via `apiKey`, o token de conta da W-API). A instância nasce
  // com 7 dias de trial grátis. Os `webhook*Url` não são enviados aqui porque as URLs de
  // webhook do sistema dependem do `instanceId`, que só é conhecido nesta resposta; os
  // webhooks são registrados logo depois via `configureWebhooks` com o instanceId real.
  static async createClientInstance(input: WApiCreateInstanceInput): Promise<WApiCreateInstanceResult> {
    if (!env.WHATSAPP_WAPI_BASE_URL) {
      throw new Error("WHATSAPP_WAPI_BASE_URL não configurado para integração W-API");
    }

    const baseURL = env.WHATSAPP_WAPI_BASE_URL.replace(/\/$/, "");
    const response = await axios.request<WApiCreateInstanceResult>({
      method: "POST",
      url: `${baseURL}/v1/client/create-instance`,
      headers: { "Content-Type": "application/json" },
      timeout: 25000,
      data: {
        apiKey: input.apiKey,
        instanceName: input.instanceName,
        lite: true,
        automaticReading: false,
        rejectCalls: false,
      },
    });

    assertWApiSuccess(response.data);
    return response.data;
  }

  constructor(instanceId: string, token: string) {
    if (!env.WHATSAPP_WAPI_BASE_URL) {
      throw new Error("WHATSAPP_WAPI_BASE_URL não configurado para integração W-API");
    }

    this.instanceId = instanceId;
    this.http = axios.create({
      baseURL: env.WHATSAPP_WAPI_BASE_URL.replace(/\/$/, ""),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 25000,
    });
  }

  private async request<T = any>(config: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.http.request({
      ...config,
      params: {
        ...(config.params || {}),
        instanceId: this.instanceId,
      },
    });
    assertWApiSuccess(response.data);
    return response.data;
  }

  qrCode() {
    return this.request({ method: "GET", url: "/v1/instance/qr-code" });
  }

  pairingCode(phone?: string) {
    if (!phone?.trim()) throw new Error("Informe o telefone para gerar o código de pareamento");
    return this.request({ method: "GET", url: "/v1/instance/pairing-code", params: { phoneNumber: phone.trim() } });
  }

  restart() {
    return this.request({ method: "GET", url: "/v1/instance/restart" });
  }

  disconnect() {
    return this.request({ method: "GET", url: "/v1/instance/disconnect" });
  }

  status() {
    return this.request({ method: "GET", url: "/v1/instance/status-instance" });
  }

  async device() {
    try {
      return await this.request({ method: "GET", url: "/v1/instance/device" });
    } catch (error) {
      // Instâncias sem provisionamento respondem 400; não é uma falha de autenticação.
      const message = axios.isAxiosError(error) ? String(error.response?.data?.message || "") : "";
      if (axios.isAxiosError(error) && error.response?.status === 400 &&
          /n[aã]o possui ip ou porta configurados/i.test(message)) {
        return {
          available: false,
          reason: "INSTANCE_NOT_PROVISIONED",
          message: "Os dados do aparelho estão indisponíveis no momento. Consulte o status da instância para acompanhar a conexão.",
        };
      }
      throw error;
    }
  }

  fetchInstance() {
    return this.request({ method: "GET", url: "/v1/instance/fetch-instance" });
  }

  async configureWebhooks(webhookUrls: WApiWebhookUrls) {
    const results = await Promise.allSettled(
      WAPI_WEBHOOK_ENDPOINTS.map(({ key, label, endpoint }) => {
        const value = webhookUrls[key];
        if (!value) {
          return Promise.resolve({ key, label, endpoint, value, skipped: true });
        }

        return this.request({ method: "PUT", url: endpoint, data: { value } }).then((response) => ({
          key,
          label,
          endpoint,
          value,
          skipped: false,
          response,
        }));
      }),
    );

    return results.map((result, index) => {
      const meta = WAPI_WEBHOOK_ENDPOINTS[index];
      if (result.status === "fulfilled") {
        return { ...result.value, ok: true };
      }

      const reason: any = result.reason;
      return {
        key: meta.key,
        label: meta.label,
        endpoint: meta.endpoint,
        value: webhookUrls[meta.key],
        skipped: false,
        ok: false,
        error: reason?.response?.data || reason?.message || "Falha ao configurar webhook na W-API",
      };
    });
  }

  send(kind: WApiMessageKind, input: WApiSendMessageInput) {
    // Na W-API, `messageId` referencia uma mensagem citada, não o id local do envio.
    const common = {
      phone: input.phone,
      ...(input.quotedMessageId ? { messageId: input.quotedMessageId } : {}),
      delayMessage: 0,
    };

    if (kind === "text") {
      return this.request({
        method: "POST",
        url: "/v1/message/send-text",
        data: { ...common, message: input.message || "" },
      });
    }

    if (kind === "image") {
      return this.request({
        method: "POST",
        url: "/v1/message/send-image",
        data: { ...common, image: input.mediaUrl, caption: input.caption || input.message || "" },
      });
    }

    if (kind === "audio") {
      return this.request({
        method: "POST",
        url: "/v1/message/send-audio",
        data: { ...common, audio: input.mediaUrl },
      });
    }

    if (kind === "video") {
      return this.request({
        method: "POST",
        url: "/v1/message/send-video",
        data: { ...common, video: input.mediaUrl, caption: input.caption || input.message || "" },
      });
    }

    const extension = (
      input.extension?.trim().replace(/^\./, "") ||
      input.fileName?.match(/\.([a-z0-9]+)$/i)?.[1] ||
      input.mediaUrl?.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] ||
      ""
    ).toLowerCase();
    if (!extension) throw new Error("Informe a extensão do documento para enviar pela W-API");
    return this.request({
      method: "POST",
      url: "/v1/message/send-document",
      data: {
        ...common,
        document: input.mediaUrl,
        extension,
        fileName: input.fileName || "documento",
        caption: input.caption || input.message || "",
      },
    });
  }

  // Envia uma localização (pino no mapa). `latitude`/`longitude` vão como string (a W-API aceita
  // string); `name` é o título e `address` o endereço completo. `messageId`, quando presente,
  // faz o envio ser uma resposta (citação) à mensagem referenciada.
  sendLocation(input: WApiSendLocationInput) {
    return this.request({
      method: "POST",
      url: "/v1/message/send-location",
      data: {
        phone: input.phone,
        latitude: input.latitude,
        longitude: input.longitude,
        name: input.name,
        address: input.address,
        ...(input.quotedMessageId ? { messageId: input.quotedMessageId } : {}),
        delayMessage: 0,
      },
    });
  }

  // Envia um cartão de contato (vCard). `contactBusinessDescription` é opcional.
  sendContact(input: WApiSendContactInput) {
    return this.request({
      method: "POST",
      url: "/v1/message/send-contact",
      data: {
        phone: input.phone,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        ...(input.contactBusinessDescription ? { contactBusinessDescription: input.contactBusinessDescription } : {}),
        ...(input.quotedMessageId ? { messageId: input.quotedMessageId } : {}),
        delayMessage: 0,
      },
    });
  }

  readMessage(phone: string, messageId: string) {
    return this.request({ method: "POST", url: "/v1/message/read-message", data: { phone, messageId } });
  }

  createPixPayment(input: WApiPaymentInput) {
    return this.request({
      method: "POST",
      url: "/v1/payment/pix/create",
      data: input,
    });
  }

  createCardSubscription(input: WApiPaymentInput) {
    return this.request({
      method: "POST",
      url: "/v1/payment/card/subscribe",
      data: input,
    });
  }
}
