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

export interface WApiSendMessageInput {
  phone: string;
  message?: string;
  mediaUrl?: string;
  caption?: string;
  fileName?: string;
  extension?: string;
  messageId: string;
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
    return response.data;
  }

  qrCode() {
    return this.request({ method: "GET", url: "/v1/instance/qr-code" });
  }

  pairingCode(phone?: string) {
    return this.request({ method: "GET", url: "/v1/instance/pairing-code", params: phone ? { phone } : undefined });
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

  device() {
    return this.request({ method: "GET", url: "/v1/instance/device" });
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
    const common = {
      phone: input.phone,
      messageId: input.messageId,
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

    return this.request({
      method: "POST",
      url: "/v1/message/send-document",
      data: {
        ...common,
        document: input.mediaUrl,
        extension: input.extension || "",
        fileName: input.fileName || "documento",
        caption: input.caption || input.message || "",
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
