import { z } from "zod";

export const pushEventFields = {
  VENDA_CONCLUIDA: "eventoVendaConcluida",
  ESTOQUE_BAIXO: "eventoEstoqueBaixo",
  SANGRIA: "eventoSangria",
  PRODUTO_ALTERADO: "eventoProdutoAlterado",
  VENCIMENTO_FINANCEIRO: "pushEventoVencimentoFinanceiro",
} as const;

export type PushNotificationEvent = keyof typeof pushEventFields;

const emailEventFields = {
  ESTOQUE_BAIXO: "emailEventoEstoqueBaixo",
  VENCIMENTO_FINANCEIRO: "emailEventoVencimentoFinanceiro",
} as const;

export type EmailNotificationEvent = keyof typeof emailEventFields;
type PushField = (typeof pushEventFields)[PushNotificationEvent];
type EmailField = (typeof emailEventFields)[EmailNotificationEvent];
type DuePreference = { financeiroVencimentosNotificacoesAtivo?: boolean | null };

export const pushNotificationSelect = {
  pushNotificacoesAtivo: true,
  eventoVendaConcluida: true,
  eventoEstoqueBaixo: true,
  eventoSangria: true,
  eventoProdutoAlterado: true,
  pushEventoVencimentoFinanceiro: true,
  financeiroVencimentosNotificacoesAtivo: true,
} as const;

export const emailNotificationSelect = {
  emailAvisos: true,
  emailNotificacoesAtivo: true,
  emailEventoEstoqueBaixo: true,
  emailEventoVencimentoFinanceiro: true,
  financeiroVencimentosNotificacoesAtivo: true,
} as const;

export const notificationEmailSchema = z.string().trim().email().max(191);

export function isPushNotificationEnabled(
  preferences: (DuePreference & Partial<Record<PushField | "pushNotificacoesAtivo", boolean | null>>) | null,
  event?: PushNotificationEvent,
) {
  if (preferences?.pushNotificacoesAtivo === false) return false;
  if (!event) return true;
  if (event === "VENCIMENTO_FINANCEIRO" && preferences?.financeiroVencimentosNotificacoesAtivo === false) return false;
  return preferences?.[pushEventFields[event]] ?? (preferences === null || event !== "SANGRIA");
}

export function getNotificationEmail(
  preferences: (DuePreference & { emailAvisos?: string | null } &
    Partial<Record<EmailField | "emailNotificacoesAtivo", boolean | null>>) | null,
  event: EmailNotificationEvent,
) {
  if (!preferences?.emailNotificacoesAtivo || !Object.prototype.hasOwnProperty.call(emailEventFields, event)) return null;
  if (preferences[emailEventFields[event]] === false) return null;
  if (event === "VENCIMENTO_FINANCEIRO" && preferences.financeiroVencimentosNotificacoesAtivo === false) return null;
  const recipient = notificationEmailSchema.safeParse(preferences.emailAvisos);
  return recipient.success ? recipient.data : null;
}
