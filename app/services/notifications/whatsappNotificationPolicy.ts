export type WhatsAppNotificationEvent =
  | "NOVA_VENDA"
  | "NOVA_OS"
  | "NOVO_LANCAMENTO"
  | "NOVO_CLIENTE"
  | "COMANDA_FATURADA"
  | "CAIXA_ABERTO"
  | "CAIXA_FECHADO";

export type WhatsAppNotificationEventField =
  | "whatsappEventoNovaVenda"
  | "whatsappEventoNovaOs"
  | "whatsappEventoNovoLancamento"
  | "whatsappEventoNovoCliente"
  | "whatsappEventoComandaFaturada"
  | "whatsappEventoCaixaAberto"
  | "whatsappEventoCaixaFechado";

export const WHATSAPP_NOTIFICATION_EVENTS: Array<{
  key: WhatsAppNotificationEvent;
  field: WhatsAppNotificationEventField;
  label: string;
}> = [
  { key: "NOVA_VENDA", field: "whatsappEventoNovaVenda", label: "Nova venda" },
  { key: "NOVA_OS", field: "whatsappEventoNovaOs", label: "Nova OS" },
  { key: "NOVO_LANCAMENTO", field: "whatsappEventoNovoLancamento", label: "Novo lancamento" },
  { key: "NOVO_CLIENTE", field: "whatsappEventoNovoCliente", label: "Novo cliente" },
  { key: "COMANDA_FATURADA", field: "whatsappEventoComandaFaturada", label: "Comanda faturada" },
  { key: "CAIXA_ABERTO", field: "whatsappEventoCaixaAberto", label: "Caixa aberto" },
  { key: "CAIXA_FECHADO", field: "whatsappEventoCaixaFechado", label: "Caixa fechado" },
];

const ADMINISTRATIVE_PERMISSIONS = new Set(["root", "admin", "gerente"]);

export function getWhatsAppNotificationEventField(event: WhatsAppNotificationEvent) {
  return WHATSAPP_NOTIFICATION_EVENTS.find((item) => item.key === event)!.field;
}

export function canConfigureWhatsAppNotifications(input: {
  enabled: boolean;
  moduleActive: boolean;
  hasInstance: boolean;
}) {
  if (!input.enabled) {
    return { ok: true as const };
  }

  if (!input.moduleActive) {
    return {
      ok: false as const,
      reason: "O modulo de WhatsApp precisa estar ativo para habilitar notificacoes.",
    };
  }

  if (!input.hasInstance) {
    return {
      ok: false as const,
      reason: "Selecione uma instancia de WhatsApp para enviar notificacoes.",
    };
  }

  return { ok: true as const };
}

export function isWhatsAppNotificationEventEnabled(
  parametros: { whatsappNotificacoesAtivo?: boolean | null } & Partial<Record<WhatsAppNotificationEventField, boolean | null>>,
  event: WhatsAppNotificationEvent,
) {
  if (!parametros.whatsappNotificacoesAtivo) {
    return false;
  }

  const field = getWhatsAppNotificationEventField(event);
  return parametros[field] ?? true;
}

export function normalizeWhatsAppNotificationPhone(value?: string | null) {
  const clean = String(value || "")
    .replace(/@.*/, "")
    .replace(/\D/g, "");

  if (clean.length < 10) {
    return "";
  }

  return clean.startsWith("55") ? clean : `55${clean}`;
}

export function selectWhatsAppNotificationRecipients(
  users: Array<{
    id: number;
    nome?: string | null;
    permissao?: string | null;
    telefone?: string | null;
    status?: string | null;
  }>,
) {
  return users
    .filter((user) => user.status === "ATIVO")
    .filter((user) => ADMINISTRATIVE_PERMISSIONS.has(String(user.permissao || "")))
    .map((user) => ({
      userId: user.id,
      name: user.nome || "Usuario",
      phone: normalizeWhatsAppNotificationPhone(user.telefone),
    }))
    .filter((user) => Boolean(user.phone));
}

export function buildWhatsAppNotificationText(input: {
  title: string;
  body: string;
}) {
  return `*${input.title.trim()}*\n${input.body.trim()}`;
}
