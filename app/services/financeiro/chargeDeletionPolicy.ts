type ChargeStatus = "PENDENTE" | "EFETIVADO" | "ESTORNADO" | "CANCELADO";

const DEFAULT_DELETABLE_STATUSES: ChargeStatus[] = ["CANCELADO", "ESTORNADO"];

export function canDeleteOperationalCharge(status: ChargeStatus, isRoot: boolean) {
  if (DEFAULT_DELETABLE_STATUSES.includes(status)) return true;
  if (status === "EFETIVADO") return false;
  return isRoot;
}

export function getOperationalChargeDeleteBlockedMessage(isRoot: boolean) {
  if (isRoot) {
    return "Cobranças efetivadas não podem ser apagadas sem estorno para preservar o histórico financeiro.";
  }

  return "A cobrança só pode ser deletada no status (CANCELADO, ESTORNADO). Apenas root pode apagar cobranças pendentes.";
}
