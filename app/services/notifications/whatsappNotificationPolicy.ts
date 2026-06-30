export type WhatsAppNotificationEvent =
  | "NOVA_VENDA"
  | "NOVA_OS"
  | "NOVO_LANCAMENTO"
  | "NOVO_CLIENTE"
  | "COMANDA_FATURADA"
  | "CAIXA_ABERTO"
  | "CAIXA_FECHADO"
  | "VENCIMENTO_FINANCEIRO";

export type WhatsAppNotificationEventField =
  | "whatsappEventoNovaVenda"
  | "whatsappEventoNovaOs"
  | "whatsappEventoNovoLancamento"
  | "whatsappEventoNovoCliente"
  | "whatsappEventoComandaFaturada"
  | "whatsappEventoCaixaAberto"
  | "whatsappEventoCaixaFechado"
  | "financeiroVencimentosNotificacoesAtivo";

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
  { key: "VENCIMENTO_FINANCEIRO", field: "financeiroVencimentosNotificacoesAtivo", label: "Vencimento financeiro" },
];

const ADMINISTRATIVE_PERMISSIONS = new Set(["root", "admin", "gerente"]);
const FINANCIAL_DUE_PERMISSIONS = new Set(["root", "admin"]);

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
  event?: WhatsAppNotificationEvent,
) {
  const allowedPermissions =
    event === "VENCIMENTO_FINANCEIRO" ? FINANCIAL_DUE_PERMISSIONS : ADMINISTRATIVE_PERMISSIONS;

  return users
    .filter((user) => user.status === "ATIVO")
    .filter((user) => allowedPermissions.has(String(user.permissao || "")))
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
