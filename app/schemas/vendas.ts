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

  status: z.enum(
    [
      "ORCAMENTO",
      "FATURADO",
      "ANDAMENTO",
      "FINALIZADO",
      "PENDENTE",
      "CANCELADO",
    ],
    {
      required_error: "O campo status é obrigatório",
      invalid_type_error: "O campo status deve ser uma string",
    }
  ),
  observacoes: z
    .string({
      invalid_type_error: "O campo observacoes deve ser uma string",
    })
    .optional(),
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
  itens: z.array(
    z.object(
      {
        id: z
          .string({
            required_error: "O campo id é obrigatório",
            invalid_type_error: "O campo id deve ser uma string",
          })
          .refine((val) => !isNaN(Number(val)), {
            message: "produtoId inválido",
          })
          .transform((val) => Number(val)),
        preco: z
          .string({
            required_error: "O campo preco é obrigatório",
            invalid_type_error: "O campo preco deve ser uma string",
          })
          .transform((val) => parseFloat(val.replace(",", "."))),
        quantidade: z
          .string({
            required_error: "O campo quantidade é obrigatório",
            invalid_type_error: "O campo quantidade deve ser uma string",
          })
          .refine((val) => !isNaN(Number(val)), {
            message: "quantidade inválida",
          })
          .transform((val) => Number(val)),
      },
      { required_error: "O campo itens é obrigatório" }
    )
  ),
});
