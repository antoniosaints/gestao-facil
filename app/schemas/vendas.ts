import { z } from "zod";

export const efetivarVendaSchema = z
  .object(
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
          required_error: "O campo pagamento eh obrigatorio",
          invalid_type_error:
            "O campo pagamento deve ser {PIX, DINHEIRO, CARTAO, TRANSFERENCIA, CHEQUE, CREDITO, DEBITO, BOLETO, OUTRO ou GATEWAY}",
        }
      ),
      lancamentoManual: z.boolean({
        required_error: "Informe o tipo de lancamento",
        invalid_type_error: "O lancamento manual deve ser selecionado ou nao",
      }),
      dataPagamento: z.string({
        required_error: "O campo dataPagamento eh obrigatorio",
        invalid_type_error: "O campo dataPagamento deve ser uma string",
      }),
      conta: z
        .number({
          invalid_type_error: "O campo conta deve ser um numero",
        })
        .optional()
        .nullable(),
      cancelarCobrancaExterna: z.boolean().optional().default(true),
      categoria: z
        .number({
          invalid_type_error: "O campo categoria deve ser um numero",
        })
        .optional()
        .nullable(),
    },
    { required_error: "Informe os dados de pagamento" }
  )
  .superRefine((data, ctx) => {
    if (data.lancamentoManual) return;

    if (!data.conta || Number(data.conta) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conta"],
        message:
          "O campo conta eh obrigatorio quando o lancamento automatico estiver ativo.",
      });
    }

    if (!data.categoria || Number(data.categoria) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoria"],
        message:
          "O campo categoria eh obrigatorio quando o lancamento automatico estiver ativo.",
      });
    }
  });

export const vendaSchema = z.object(
  {
    id: z
      .number({
        invalid_type_error: "O campo id deve ser um numero",
      })
      .nullable()
      .optional(),
    comandaId: z
      .number({
        invalid_type_error: "O campo comandaId deve ser um numero",
      })
      .int()
      .nullable()
      .optional(),
    data: z
      .string({
        required_error: "O campo data e obrigatorio",
        invalid_type_error: "O campo data deve ser uma string",
      })
      .refine((val) => !isNaN(Date.parse(val)), { message: "Data invalida" })
      .transform((val) => new Date(val)),
    clienteId: z
      .number({
        invalid_type_error: "O campo clienteId deve ser um numero",
      })
      .nullable()
      .refine((val) => val === null || !isNaN(Number(val)), {
        message: "clienteId invalido",
      })
      .optional(),
    status: z
      .enum(["ORCAMENTO", "ANDAMENTO", "FINALIZADO", "PENDENTE", "CANCELADO"], {
        required_error: "O campo status e obrigatorio",
        invalid_type_error: "O campo status deve ser uma string",
      })
      .default("FINALIZADO"),
    observacoes: z
      .string({
        invalid_type_error: "O campo observacoes deve ser uma string",
      })
      .optional(),
    vendedorId: z
      .number({
        invalid_type_error: "O campo vendedorId deve ser um numero",
        required_error: "O campo vendedor e obrigatorio",
      })
      .refine((val) => val === undefined || !isNaN(Number(val)), {
        message: "vendedorId invalido",
      })
      .transform((val) => (val ? Number(val) : undefined))
      .optional()
      .nullable(),
    desconto: z
      .number({
        invalid_type_error: "O campo desconto deve ser um numero",
      })
      .nullable()
      .refine((val) => val === null || !isNaN(Number(val)), {
        message: "desconto invalido",
      })
      .optional(),
    garantia: z
      .number({
        invalid_type_error: "O campo garantia deve ser um numero",
      })
      .optional()
      .refine((val) => val === undefined || !isNaN(Number(val)), {
        message: "Garantia invalida",
      })
      .transform((val) => (val ? Number(val) : undefined)),
    itens: z.array(
      z.object(
        {
          id: z
            .number({
              required_error: "O campo id e obrigatorio",
              invalid_type_error: "O campo id deve ser um numero",
            })
            .refine((val) => !isNaN(Number(val)), {
              message: "produtoId invalido",
            })
            .transform((val) => Number(val)),
          tipo: z.enum(["PRODUTO", "SERVICO"], {
            required_error: "O campo tipo e obrigatorio",
            invalid_type_error: "O campo tipo deve ser (PRODUTO ou SERVICO)",
          }),
          nome: z
            .string({
              invalid_type_error: "O campo nome deve ser uma string",
            })
            .optional(),
          preco: z.number({
            required_error: "O campo preco e obrigatorio",
            invalid_type_error: "O campo preco deve ser um numero",
          }),
          quantidade: z
            .number({
              required_error: "O campo quantidade e obrigatorio",
              invalid_type_error: "O campo quantidade deve ser um numero",
            })
            .refine((val) => !isNaN(Number(val)), {
              message: "quantidade invalida",
            }),
        },
        {
          required_error: "Preencha o item da venda",
          invalid_type_error: "O item deve ser um objeto",
        }
      ),
      {
        required_error: "Preencha o array de itens da venda",
        invalid_type_error: "O array de itens deve ser um array",
      }
    ),
  },
  { required_error: "Informe os dados da venda" }
);
