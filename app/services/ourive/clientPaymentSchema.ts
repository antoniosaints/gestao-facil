import { z } from "zod";
import { MetodoPagamento } from "../../../generated/client";

export const clientPaymentFields = {
  antecipacaoCliente: z.coerce.number().nonnegative().max(99_999_999),
  formaPagamentoCliente: z.nativeEnum(MetodoPagamento).nullable(),
};

export function validateClientPayment(
  data: { antecipacaoCliente: number; formaPagamentoCliente?: string | null },
  context: z.RefinementCtx,
) {
  if (data.antecipacaoCliente > 0 && !data.formaPagamentoCliente)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["formaPagamentoCliente"],
      message: "Informe a forma de pagamento do cliente.",
    });
}

export const clientPaymentSchema = z
  .object(clientPaymentFields)
  .superRefine(validateClientPayment);
