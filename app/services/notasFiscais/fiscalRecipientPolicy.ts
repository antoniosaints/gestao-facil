import { validarCpfCnpj } from "../../helpers/formatters";

export type FiscalRecipientStatus = "SEM_CLIENTE" | "SEM_DOCUMENTO" | "DOCUMENTO_INVALIDO" | "DOCUMENTO_VALIDO";

export function fiscalRecipientStatus(customer: { documento?: string | null } | null | undefined): FiscalRecipientStatus {
  if (!customer) return "SEM_CLIENTE";
  if (!String(customer.documento || "").trim()) return "SEM_DOCUMENTO";
  return validarCpfCnpj(customer.documento || "") ? "DOCUMENTO_VALIDO" : "DOCUMENTO_INVALIDO";
}
