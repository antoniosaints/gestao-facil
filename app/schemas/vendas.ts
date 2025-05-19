import { z } from "zod";

export const vendaSchema = z.object({
  data: z
    .string({
      required_error: "O campo data é obrigatório",
      invalid_type_error: "O campo data deve ser uma string",
    })
    .refine((val) => !isNaN(Date.parse(val)), { message: "Data inválida" })
    .transform((val) => new Date(val)),
  clienteId: z
    .string()
    .optional()
    .refine((val) => val === undefined || !isNaN(Number(val)), {
      message: "clienteId inválido",
    })
    .transform((val) => (val ? Number(val) : undefined)),

  status: z.enum(["ORCAMENTO", "FATURADO", "EM_ANDAMENTO", "FINALIZADO"], {
    required_error: "O campo status é obrigatório",
    invalid_type_error: "O campo status deve ser uma string",
  }),

  vendedorId: z
    .string({
      invalid_type_error: "O campo vendedorId deve ser uma string",
    })
    .optional()
    .refine((val) => val === undefined || !isNaN(Number(val)), {
      message: "vendedorId inválido",
    })
    .transform((val) => (val ? Number(val) : undefined)),

  garantia: z
    .string({
      invalid_type_error: "O campo garantia deve ser uma string",
    })
    .optional()
    .refine((val) => val === undefined || !isNaN(Number(val)), {
      message: "Garantia inválida",
    })
    .transform((val) => (val ? Number(val) : undefined)),
});
