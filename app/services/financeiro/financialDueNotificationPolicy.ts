import { differenceInCalendarDays, startOfDay } from "date-fns";

export type FinancialDueNotificationMilestone = "D3" | "D1" | "D0" | "D1_APOS";
export type FinancialDueNotificationSourceType =
  | "LANCAMENTO_PARCELA"
  | "CLIENTE_LANCAMENTO_PARCELA"
  | "ASSINATURA_PAGAR";
export type ClientDueNotificationChannel = "WHATSAPP" | "EMAIL" | "SMS";

const MILESTONE_BY_DAY_DIFF: Record<number, FinancialDueNotificationMilestone> = {
  3: "D3",
  1: "D1",
  0: "D0",
  [-1]: "D1_APOS",
};

export function getFinancialDueMilestone(
  dueDate: Date,
  today = new Date(),
): FinancialDueNotificationMilestone | null {
  const diff = differenceInCalendarDays(startOfDay(dueDate), startOfDay(today));
  return MILESTONE_BY_DAY_DIFF[diff] ?? null;
}

export function selectFinancialDueNotificationRecipients(
  users: Array<{
    id: number;
    nome?: string | null;
    permissao?: string | null;
    status?: string | null;
  }>,
) {
  return users
    .filter((user) => user.status === "ATIVO")
    .filter((user) => user.permissao === "root" || user.permissao === "admin")
    .map((user) => ({
      id: user.id,
      nome: user.nome || "Usuario",
    }));
}

export function canEnableClientDueNotification(input: {
  tipo?: string | null;
  clienteId?: number | string | null;
  notificarClienteVencimento?: boolean | null;
}) {
  return (
    input.tipo === "RECEITA" &&
    Boolean(input.notificarClienteVencimento) &&
    Boolean(Number(input.clienteId))
  );
}

export function selectClientDueNotificationChannels(): ClientDueNotificationChannel[] {
  return ["WHATSAPP"];
}

export function getFinancialDueMilestoneLabel(milestone: FinancialDueNotificationMilestone) {
  if (milestone === "D3") return "vence em 3 dias";
  if (milestone === "D1") return "vence amanha";
  if (milestone === "D0") return "vence hoje";
  return "venceu ontem";
}
