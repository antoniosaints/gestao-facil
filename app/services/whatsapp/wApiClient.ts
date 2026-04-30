import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { env } from "../../utils/dotenv";

export type WApiMessageKind = "text" | "image" | "audio" | "video" | "document";
export type WApiWebhookKey = "connected" | "disconnected" | "delivery" | "received" | "status" | "presence";

export const WAPI_WEBHOOK_ENDPOINTS: Array<{ key: WApiWebhookKey; label: string; endpoint: string }> = [
  { key: "connected", label: "Ao conectar", endpoint: "/v1/instance/instance/update-webhook-connected" },
  { key: "disconnected", label: "Ao desconectar", endpoint: "/v1/instance/instance/update-webhook-disconnected" },
  { key: "delivery", label: "Ao enviar", endpoint: "/v1/instance/instance/update-webhook-delivery" },
  { key: "received", label: "Ao receber", endpoint: "/v1/instance/instance/update-webhook-received" },
  { key: "status", label: "Status de mensagens", endpoint: "/v1/instance/instance/update-webhook-status" },
  { key: "presence", label: "Status do chat", endpoint: "/v1/instance/instance/update-webhook-presence" },
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

export class WApiClient {
  private readonly http: AxiosInstance;
  private readonly instanceId: string;

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
}
