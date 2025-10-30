import { z } from "zod";

export const efetivarOsSchema = z.object(
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
    lancamentoManual: z.boolean({
      required_error: "Informe o tipo de lançamento",
      invalid_type_error: "O lançamento manual deve ser selecionado ou não"
    }),
    dataPagamento: z.string({
      required_error: "O campo dataPagamento é obrigatório",
      invalid_type_error: "O campo dataPagamento deve ser uma string",
    }),
    conta: z
      .number({
        required_error: "O campo conta é obrigatório",
        invalid_type_error: "O campo conta deve ser um número",
      })
      .optional(),
    categoria: z.number({
      required_error: "O campo categoria é obrigatório",
      invalid_type_error: "O campo categoria deve ser um número",
    }),
  },
  { required_error: "Informe os dados de pagamento" }
);

export const saveOrdemServicoSchema = z.object(
  {
    id: z
      .number({
        invalid_type_error: "O campo id deve ser um numero",
      })
      .nullable()
      .optional(),
    data: z
      .string({
        required_error: "O campo data é obrigatório",
        invalid_type_error: "O campo data deve ser uma string",
      })
      .refine((val) => !isNaN(Date.parse(val)), { message: "Data inválida" })
      .transform((val) => new Date(val)),
    clienteId: z
      .number({
        invalid_type_error: "O campo clienteId deve ser um numero",
        required_error: "O campo clienteId é obrigatório",
      })
      .refine((val) => val === null || !isNaN(Number(val)), {
        message: "clienteId inválido",
      }),
    status: z
      .enum(["ABERTA", "ORCAMENTO", "APROVADA", "ANDAMENTO", "FATURADA", "CANCELADA"], {
        invalid_type_error: "O campo status deve ser uma string",
      })
      .optional()
      .default("ABERTA"),
    descricao: z
      .string({
        invalid_type_error: "O campo descricao deve ser uma string",
      })
      .optional(),
    descricaoCliente: z
      .string({
        invalid_type_error: "O campo descricaoCliente deve ser uma string",
      })
      .optional(),
    vendedorId: z
      .number({
        invalid_type_error: "O campo vendedorId deve ser um numero",
        required_error: "O campo vendedorId é obrigatório",
      })
      .refine((val) => val === undefined || !isNaN(Number(val)), {
        message: "vendedorId inválido",
      })
      .transform((val) => Number(val)),
    desconto: z
      .number({
        invalid_type_error: "O campo desconto deve ser um numero",
      })
      .nullable()
      .refine((val) => val === null || !isNaN(Number(val)), {
        message: "desconto inválido",
      })
      .optional(),
    garantia: z
      .number({
        invalid_type_error: "O campo garantia deve ser um numero",
      })
      .optional(),
    itens: z.array(
      z.object(
        {
          id: z
            .number({
              required_error: "O campo id é obrigatório",
              invalid_type_error: "O campo id deve ser um numero",
            })
            .refine((val) => !isNaN(Number(val)), {
              message: "id inválido",
            })
            .transform((val) => Number(val)),
          tipo: z.enum(["PRODUTO", "SERVICO"], {
            required_error: "O campo tipo é obrigatório",
            invalid_type_error: "O campo tipo deve ser (PRODUTO ou SERVICO)",
          }),
          nome: z
            .string({
              required_error: "O campo nome é obrigatório",
              invalid_type_error: "O campo nome deve ser uma string",
            }),
          valor: z.number({
            required_error: "O campo valor é obrigatório",
            invalid_type_error: "O campo valor deve ser um numero",
          }),
          quantidade: z
            .number({
              required_error: "O campo quantidade é obrigatório",
              invalid_type_error: "O campo quantidade deve ser um numero",
            })
            .refine((val) => !isNaN(Number(val)), {
              message: "quantidade inválida",
            }),
        },
        {
          required_error: "Preencha os itens da OS",
          invalid_type_error: "O item deve ser um objeto",
        }
      ),
      {
        required_error: "Preencha o array de itens da OS",
        invalid_type_error: "O array de itens deve ser um array",
      }
    ).min(1, { message: "A OS deve ter pelo menos um item" }),
  },
  { required_error: "Informe os dados da OS" }
);
