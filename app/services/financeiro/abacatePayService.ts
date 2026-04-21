import crypto from "node:crypto";

type AbacatePaySdkModule = typeof import("@abacatepay/sdk");
type AbacatePayClient = ReturnType<AbacatePaySdkModule["AbacatePay"]>;

const importAbacatePaySdk = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<AbacatePaySdkModule>;

let abacatePaySdkPromise: Promise<AbacatePaySdkModule> | null = null;

function loadAbacatePaySdk() {
  if (!abacatePaySdkPromise) {
    abacatePaySdkPromise = importAbacatePaySdk("@abacatepay/sdk");
  }

  return abacatePaySdkPromise;
}

async function createAbacatePayClient(apiKey: string): Promise<AbacatePayClient> {
  const { AbacatePay } = await loadAbacatePaySdk();
  return AbacatePay({ secret: apiKey });
}

export type AbacatePayMethod = "PIX" | "CARD";
export type AbacatePayTransparentMethod = "PIX" | "BOLETO";
export type AbacatePayCheckoutStatus =
  | "PENDING"
  | "PAID"
  | "EXPIRED"
  | "CANCELLED"
  | "REFUNDED";
export type AbacatePayProductCycle =
  | "WEEKLY"
  | "MONTHLY"
  | "SEMIANNUALLY"
  | "ANNUALLY";

export interface AbacatePayCustomer {
  id: string;
  devMode: boolean;
  name?: string | null;
  cellphone?: string | null;
  email: string;
  taxId?: string | null;
  country?: string | null;
  zipCode?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AbacatePayProduct {
  id: string;
  externalId: string;
  name: string;
  description?: string | null;
  price: number;
  devMode: boolean;
  currency: "BRL";
  status: string;
  imageUrl?: string | null;
  cycle?: AbacatePayProductCycle | null;
  createdAt: string;
  updatedAt: string;
}

export interface AbacatePayCheckout {
  id: string;
  externalId?: string | null;
  url: string;
  amount: number;
  paidAmount?: number | null;
  status: AbacatePayCheckoutStatus;
  items: Array<{ id: string; quantity: number }>;
  methods?: AbacatePayMethod[];
  customerId?: string | null;
  returnUrl?: string | null;
  completionUrl?: string | null;
  receiptUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AbacatePayTransparentCharge {
  id: string;
  amount: number;
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED";
  devMode: boolean;
  url?: string | null;
  barCode?: string | null;
  brCode?: string | null;
  brCodeBase64?: string | null;
  platformFee?: number | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface AbacatePayWebhookPayload<T = Record<string, any>> {
  id: string;
  event: string;
  apiVersion: number;
  devMode: boolean;
  data: T;
}

export interface AbacatePayWebhookConfig {
  id: string;
  name: string;
  endpoint: string;
  events: string[];
  devMode: boolean;
  v2?: boolean;
  createdAt: string;
  updatedAt: string;
}

function sanitizeAbacateError(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const message =
      "message" in error && typeof error.message === "string"
        ? error.message
        : null;
    const name =
      "name" in error && typeof error.name === "string" ? error.name : "";

    if (name === "AbacatePayError") {
      return message || "Erro ao comunicar com a AbacatePay.";
    }

    if (name.startsWith("HTTPError(")) {
      const status =
        "status" in error && typeof error.status === "number"
          ? error.status
          : null;

      return message || `Erro HTTP ${status ?? "desconhecido"} ao comunicar com a AbacatePay.`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Erro desconhecido ao comunicar com a AbacatePay.";
}

export class AbacatePayService {
  private readonly clientPromise: Promise<AbacatePayClient>;

  constructor(apiKey: string) {
    this.clientPromise = createAbacatePayClient(apiKey);
  }

  private async getClient() {
    return this.clientPromise;
  }

  private async post<T>(route: string, body: unknown) {
    try {
      const client = await this.getClient();
      return (await client.rest.post(route, { body })) as T;
    } catch (error) {
      throw new Error(sanitizeAbacateError(error));
    }
  }

  private async get<T>(route: string) {
    try {
      const client = await this.getClient();
      return (await client.rest.get(route)) as T;
    } catch (error) {
      throw new Error(sanitizeAbacateError(error));
    }
  }

  static verifyWebhookSignature(
    rawBody: string,
    webhookSecret: string,
    signatureFromHeader?: string | null,
  ) {
    if (!signatureFromHeader || !webhookSecret) return false;

    const bodyBuffer = Buffer.from(rawBody, "utf8");
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(bodyBuffer)
      .digest("base64");

    const a = Buffer.from(expectedSignature);
    const b = Buffer.from(signatureFromHeader);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async createCustomer(payload: {
    email: string;
    name?: string;
    taxId?: string;
    cellphone?: string;
    zipCode?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.post<AbacatePayCustomer>("/customers/create", payload);
  }

  async createProduct(payload: {
    externalId: string;
    name: string;
    price: number;
    currency?: "BRL";
    description?: string;
    imageUrl?: string | null;
    cycle?: AbacatePayProductCycle | null;
  }) {
    return this.post<AbacatePayProduct>("/products/create", {
      currency: "BRL",
      ...payload,
    });
  }

  async createCheckout(payload: {
    items: Array<{ id: string; quantity: number }>;
    methods?: AbacatePayMethod[];
    customerId?: string;
    returnUrl?: string;
    completionUrl?: string;
    coupons?: string[];
    externalId?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.post<AbacatePayCheckout>("/checkouts/create", payload);
  }

  async createPaymentLink(payload: {
    frequency?: "MULTIPLE_PAYMENTS";
    items: Array<{ id: string; quantity: number }>;
    methods?: AbacatePayMethod[];
    returnUrl?: string;
    completionUrl?: string;
    coupons?: string[];
    externalId?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.post<AbacatePayCheckout>("/payment-links/create", {
      frequency: "MULTIPLE_PAYMENTS",
      ...payload,
    });
  }

  async createSubscriptionCheckout(payload: {
    items: Array<{ id: string; quantity: number }>;
    methods?: Array<"CARD">;
    customerId?: string;
    returnUrl?: string;
    completionUrl?: string;
    coupons?: string[];
    externalId?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.post<AbacatePayCheckout>("/subscriptions/create", payload);
  }

  async createTransparentCharge(payload: {
    method: AbacatePayTransparentMethod;
    data: {
      amount: number;
      description?: string;
      expiresIn?: number;
      externalId?: string;
      metadata?: Record<string, unknown>;
      customer?: {
        name?: string;
        email?: string;
        taxId?: string;
        cellphone?: string;
      };
    };
  }) {
    return this.post<AbacatePayTransparentCharge>("/transparents/create", {
      method: payload.method,
      data: payload.data,
    });
  }

  async getTransparentStatus(id: string) {
    return this.get<
      Pick<AbacatePayTransparentCharge, "id" | "status" | "expiresAt">
    >(`/transparents/check?id=${encodeURIComponent(id)}`);
  }

  async listWebhooks(limit = 100) {
    return this.get<AbacatePayWebhookConfig[]>(
      `/webhooks/list?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  async createWebhook(payload: {
    name: string;
    endpoint: string;
    secret: string;
    events: string[];
  }) {
    return this.post<AbacatePayWebhookConfig>("/webhooks/create", payload);
  }
}
