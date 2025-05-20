import { z } from "zod";
const subscriptionCycle = z
  .enum([
    "MONTHLY",
    "BIMONTHLY",
    "WEEKLY",
    "BIWEEKLY",
    "QUARTERLY",
    "SEMIANNUALLY",
    "YEARLY",
  ])
  .optional();

const billingType = z.enum(["UNDEFINED", "BOLETO", "CREDIT_CARD", "PIX"], {
  required_error:
    "O billingType é obrigatório, deve ser um dos seguintes valores: UNDEFINED, BOLETO, CREDIT_CARD, PIX",
  invalid_type_error:
    "O billingType deve ser um dos seguintes valores: UNDEFINED, BOLETO, CREDIT_CARD, PIX",
});
const chargeType = z.enum(["DETACHED", "RECURRENT", "INSTALLMENT"], {
  required_error:
    "O chargeType é obrigatório, deve ser um dos seguintes valores: DETACHED, RECURRENT, INSTALLMENT",
  invalid_type_error:
    "O chargeType deve ser um dos seguintes valores: DETACHED, RECURRENT, INSTALLMENT",
});
const pixAddressKeyType = z.enum(["EVP", "CPF", "CNPJ", "EMAIL", "PHONE"], {
  required_error:
    "O pixAddressKeyType é obrigatório, deve ser um dos seguintes valores: EVP, CPF, CNPJ, EMAIL, PHONE",
  invalid_type_error:
    "O pixAddressKeyType deve ser um dos seguintes valores: EVP, CPF, CNPJ, EMAIL, PHONE",
});
const operationType = z.enum(["PIX", "TED"], {
  required_error:
    "O operationType é obrigatório, deve ser um dos seguintes valores: PIX, TED",
  invalid_type_error:
    "O operationType deve ser um dos seguintes valores: PIX, TED",
});
const dateFormated = z
  .string()
  .regex(
    /^\d{4}\-\d{2}\-\d{2}$/,
    "O campo data deve estar no formato YYYY-MM-DD"
  );

const callback = z
  .object(
    {
      successUrl: z
        .string({
          required_error: "O campo successUrl é obrigatório",
          invalid_type_error: "O campo successUrl deve ser uma string",
        })
        .url("A URL do callback success deve ser válida"),
      autoRedirect: z.boolean({
        required_error: "O campo autoRedirect é obrigatório",
        invalid_type_error: "O campo autoRedirect deve ser um booleano",
      }),
    },
    {
      invalid_type_error:
        "callback deve ser um objeto com as seguintes propriedades: successUrl, autoRedirect",
      required_error: "callback é obrigatório",
    }
  )
  .describe(
    "callback é um objeto com as seguintes propriedades: successUrl, autoRedirect"
  );
export const AsaasPaymentLinkSchema = z.object({
  name: z
    .string({
      required_error: "O campo name é obrigatório",
      invalid_type_error: "O campo name deve ser uma string",
    })
    .min(1, "O campo name deve ter pelo menos 1 caractere"),
  description: z.string().optional(),
  endDate: dateFormated.optional(),
  value: z.number().min(5, "O Valor mínimo da cobrança deve ser 5").optional(),
  billingType: billingType,
  chargeType: chargeType,
  dueDateLimitDays: z.enum(["1", "2", "5", "10", "20", "30", "45"], {
    required_error:
      "O campo 'dueDateLimitDays' é obrigatório e deve ser um dos valores permitidos: 1, 2, 5, 10, 20, 30 ou 45.",
    invalid_type_error:
      "Valor inválido para 'dueDateLimitDays'. Aceitos: 1, 2, 5, 10, 20, 30 ou 45.",
  }),
  subscriptionCycle: subscriptionCycle,
  maxInstallmentCount: z.number({
    required_error: "O campo maxInstallmentCount é obrigatório",
    invalid_type_error: "O campo maxInstallmentCount deve ser um número",
  }),
  externalReference: z.string().optional(),
  notificationEnabled: z
    .boolean({
      invalid_type_error: "O campo notificationEnabled deve ser um booleano",
    })
    .optional(),
  callback: callback,
  isAddressRequired: z.boolean({
    required_error: "O campo isAddressRequired é obrigatório",
    invalid_type_error: "O campo isAddressRequired deve ser um booleano",
  }),
});
export type AsaasPaymentLink = z.infer<typeof AsaasPaymentLinkSchema>;

export const AsaasConfirmPaymentWithCashFreeSchema = z.object({
  paymentDate: dateFormated,
  value: z.number({
    required_error: "O campo value é obrigatório",
    invalid_type_error: "O campo value deve ser um número",
  }),
  notifyCustomer: z.boolean().optional(),
});
export type AsaasConfirmPaymentWithCashFree = z.infer<
  typeof AsaasConfirmPaymentWithCashFreeSchema
>;
export const AsaasDiscountObjectSchema = z.object({
  value: z.number({
    required_error: "O campo value é obrigatório",
    invalid_type_error: "O campo value deve ser um número",
  }),
  dueDateLimitDays: z.number(),
  type: z.enum(["PERCENTAGE", "FIXED"], {
    required_error:
      "O campo type é obrigatório, deve ser um dos seguintes valores: PERCENTAGE, FIXED",
    invalid_type_error:
      "O campo type deve ser um dos seguintes valores: PERCENTAGE, FIXED",
  }),
});
export type AsaasDiscountObject = z.infer<typeof AsaasDiscountObjectSchema>;
export const AsaasInterestObjectSchema = z.object({
  value: z.number(),
});
export type AsaasInterestObject = z.infer<typeof AsaasInterestObjectSchema>;
export const AsaasFineObjectSchema = z.object({
  value: z.number(),
  type: z.enum(["PERCENTAGE", "FIXED"], {
    required_error:
      "O campo type é obrigatório, deve ser um dos seguintes valores: PERCENTAGE, FIXED",
    invalid_type_error:
      "O campo type deve ser um dos seguintes valores: PERCENTAGE, FIXED",
  }),
});
export type AsaasFineObject = z.infer<typeof AsaasFineObjectSchema>;
export const AsaasSplitObjectSchema = z.object({
  walletId: z.string().min(1),
  fixedValue: z.number().optional(),
  percentualValue: z.number().optional(),
  externalReference: z.string().optional(),
  description: z.string().optional(),
});
export type AsaasSplitObject = z.infer<typeof AsaasSplitObjectSchema>;
export const AsaasCustomerSchema = z.object({
  name: z
    .string({
      required_error: "O campo name é obrigatório",
      invalid_type_error: "O campo name deve ser uma string",
    })
    .min(1, "O campo name deve ter pelo menos 1 caractere"),
  cpfCnpj: z
    .string({
      required_error: "O campo cpfCnpj é obrigatório",
      invalid_type_error: "O campo cpfCnpj deve ser uma string",
    })
    .min(10, "O campo cpfCnpj deve ter pelo menos 10 caracteres"),
  email: z
    .string({
      invalid_type_error: "O campo email deve ser uma string",
    })
    .email("O campo email deve ter um email válido")
    .optional(),
  phone: z.string().optional(),
  mobilePhone: z.string().optional(),
  address: z.string().optional(),
  addressNumber: z.string().optional(),
  complement: z.string().optional(),
  province: z.string().optional(),
  postalCode: z.string().optional(),
  externalReference: z.string().optional(),
  observations: z.string().optional(),
});
export type AsaasCustomer = z.infer<typeof AsaasCustomerSchema>;

export const AsaasChargeSchema = z.object({
  customer: z.string({
    required_error: "O campo customer é obrigatório",
    invalid_type_error: "O campo customer deve ser uma string",
  }),
  billingType: billingType,
  value: z.number({
    required_error: "O campo value é obrigatório",
    invalid_type_error: "O campo value deve ser um número",
  }),
  dueDate: dateFormated,
  description: z.string().max(500).optional(),
  daysAfterDueDateToRegistrationCancellation: z.number().int().optional(),
  externalReference: z.string().optional(),
  installmentCount: z.number().int().optional(),
  totalValue: z.number().optional(),
  installmentValue: z.number().optional(),
  callback: callback,
});
export type AsaasCharge = z.infer<typeof AsaasChargeSchema>;

export const AsaasSubscriptionSchema = z.object({
  customer: z.string({
    required_error: "O campo customer é obrigatório",
    invalid_type_error: "O campo customer deve ser uma string",
  }),
  billingType: billingType,
  value: z.number().min(5, "O Valor mínimo da assinatura deve ser 5"),
  nextDueDate: dateFormated,
  discount: AsaasDiscountObjectSchema.optional(),
  interest: AsaasInterestObjectSchema.optional(),
  fine: AsaasFineObjectSchema.optional(),
  cycle: subscriptionCycle,
  description: z.string().max(500).optional(),
  endDate: dateFormated.optional(),
  maxPayments: z.number().int("O maxPayments deve ser um inteiro").optional(),
  externalReference: z.string().optional(),
  split: z.array(AsaasSplitObjectSchema).optional(),
  callback: callback,
});
export type AsaasSubscription = z.infer<typeof AsaasSubscriptionSchema>;