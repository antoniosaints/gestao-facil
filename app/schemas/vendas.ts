import { z } from "zod";

export const efetivarVendaSchema = z.object(
  {
    pagamento: z.enum(
      [
        "PIX",
        "DINHEIRO",
        "CARTAO",
        "TRANSFERENCIA",
        "CHEQUE",
        "CREDITO",
        "DEBITO",
        "BOLETO",
        "OUTRO",
        "GATEWAY",
      ],
      {
        required_error: "O campo pagamento é obrigatório",
        invalid_type_error:
          "O campo pagamento deve ser {PIX, DINHEIRO, CARTAO, TRANSFERENCIA, CHEQUE, CREDITO, DEBITO, BOLETO, OUTRO ou GATEWAY}",
      }
    ),
    dataPagamento: z.string({
      required_error: "O campo dataPagamento é obrigatório",
      invalid_type_error: "O campo dataPagamento deve ser uma string",
    }),
    conta: z.string({
      required_error: "O campo conta é obrigatório",
      invalid_type_error: "O campo conta deve ser um número",
    }).transform((val) => Number(val)).optional(),
    categoria: z.string({
      required_error: "O campo categoria é obrigatório",
      invalid_type_error: "O campo categoria deve ser um número",
    }).transform((val) => Number(val)),
  },
  { required_error: "Informe os dados de pagamento" }
);

export const vendaSchema = z.object(
  {
    id: z.string().optional(),
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

    status: z
      .enum(["ORCAMENTO", "ANDAMENTO", "FINALIZADO", "PENDENTE", "CANCELADO"], {
        required_error: "O campo status é obrigatório",
        invalid_type_error: "O campo status deve ser uma string",
      })
      .default("FINALIZADO"),
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
    desconto: z
      .string({
        invalid_type_error: "O campo desconto deve ser uma string",
      })
      .transform((val) => {
        if (val) {
          return parseFloat(val.replace(",", "."));
        }
        return null;
      })
      .optional(),
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
  },
  { required_error: "Informe os dados da venda" }
);
