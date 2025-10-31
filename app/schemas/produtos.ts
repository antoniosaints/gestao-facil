import { z } from "zod";

const intNumberFormatter = (message: string) =>
  z
    .string({
      invalid_type_error: message,
    })
    .nullable()
    .transform((val) => {
      if (!val || val.trim() === "") return null;

      const num = Number(val);
      return isNaN(num) ? null : num;
    });
const moneyFormatter = (message: string) =>
  z
    .string({
      invalid_type_error: message,
    })
    .transform((val) => (val ? parseFloat(val.replace(",", ".")) : undefined));

export const ProdutoSchema = z.object({
  id: z
    .number({
      invalid_type_error: "id deve ser um número",
    })
    .optional(),
  contaId: z
    .string({
      invalid_type_error: "contaId deve ser uma string",
    })
    .transform((val) => parseInt(val, 10))
    .optional(),
  nome: z
    .string({
      required_error: "nome é obrigatório",
      invalid_type_error: "nome deve ser uma string",
    })
    .min(2)
    .trim(),
  descricao: z
    .string({
      invalid_type_error: "descricao deve ser uma string",
    })
    .optional()
    .nullable()
    .transform((val) => {
      if (val === "") return null;
      return val;
    })
    .optional(),
  preco: z
    .string({
      required_error: "preco é obrigatório",
      invalid_type_error: "preco deve ser uma string",
    })
    .transform((val) => parseFloat(val.replace(",", "."))),
  estoque: z.number({
    required_error: "estoque é obrigatório",
    invalid_type_error: "estoque deve ser uma número",
  }),
  minimo: z.number({
    required_error: "minimo é obrigatório",
    invalid_type_error: "minimo deve ser uma número",
  }),
  precoCompra: z
    .string({
      invalid_type_error: "precoCompra deve ser uma string",
    })
    .transform((val) => parseFloat(val.replace(",", ".")))
    .optional(),
  unidade: z.string().optional(),
  codigo: z.string().optional(),
  entradas: z.boolean({
    required_error: "entradas é obrigatório",
    invalid_type_error: "entradas deve ser um booleano",
  }),
  saidas: z.boolean({
    required_error: "saidas é obrigatório",
    invalid_type_error: "saidas deve ser um booleano",
  }),
  producaoLocal: z
    .boolean({
      invalid_type_error: "produção local deve ser um booleano",
    })
    .default(false)
    .optional(),
  custoMedioProducao: z
    .number({
      invalid_type_error: "custoMedioProducao deve ser um número",
    })
    .default(0)
    .optional(),
  controlaEstoque: z
    .boolean({
      invalid_type_error: "controlaEstoque deve ser um booleano",
    })
    .default(true)
    .optional(),
});
export const ReposicaoEstoqueSchema = z.object({
  produtoId: z.number({
    required_error: "produtoId é obrigatório",
    invalid_type_error: "produtoId deve ser um número",
  }),
  quantidade: z.number({
    required_error: "quantidade é obrigatório",
    invalid_type_error: "quantidade deve ser um número",
  }),
  custo: z.number({
    invalid_type_error: "custo deve ser um número",
    required_error: "custo é obrigatório",
  }),
  desconto: z
    .number({
      invalid_type_error: "desconto deve ser um número",
    })
    .nullable()
    .optional(),
  frete: z
    .number({
      invalid_type_error: "frete deve ser um número",
    })
    .nullable()
    .optional(),
  notaFiscal: z
    .string({
      invalid_type_error: "notaFiscal deve ser uma string",
    })
    .nullable()
    .transform((val) => (val ? val : null))
    .optional(),
  fornecedor: z
    .number({
      invalid_type_error: "fornecedor deve ser um número",
    })
    .nullable()
    .optional(),
});
