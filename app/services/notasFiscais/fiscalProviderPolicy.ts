export type FiscalProviderStatus =
  | "PENDENTE"
  | "EMITINDO"
  | "EM_PROCESSAMENTO"
  | "AUTORIZADA"
  | "CANCELADA"
  | "REJEITADA";

/** Normaliza os estados assíncronos retornados pelo PlugNotas. */
export function fiscalStatusFromProvider(value: unknown): FiscalProviderStatus {
  switch (String(value || "").trim().toUpperCase()) {
    case "CONCLUIDO":
    case "CONCLUÍDO":
    case "AUTORIZADO":
      return "AUTORIZADA";
    case "CANCELADO":
      return "CANCELADA";
    case "REJEITADO":
      return "REJEITADA";
    case "AGENDADO":
    case "PROCESSANDO":
      return "EM_PROCESSAMENTO";
    default:
      return "EM_PROCESSAMENTO";
  }
}

export function extractPlugNotasResult(response: any) {
  return Array.isArray(response) ? response[0] : response?.data?.[0] || response?.data || response || {};
}
