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
    .string()
    .transform((val) => parseInt(val, 10))
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
  estoque: z
    .string({
      required_error: "estoque é obrigatório",
      invalid_type_error: "estoque deve ser uma string",
    })
    .refine(
      (val) => {
        const regex = /^[0-9]+(,[0-9]{1,2})?$/;
        return regex.test(val);
      },
      {
        message: "estoque deve ser uma string de um número válido",
      }
    )
    .transform((val) => parseInt(val, 10)),
  minimo: z
    .string({
      required_error: "minimo é obrigatório",
      invalid_type_error: "minimo deve ser uma string",
    })
    .refine(
      (val) => {
        const regex = /^[0-9]+(,[0-9]{1,2})?$/;
        return regex.test(val);
      },
      {
        message: "minimo deve ser uma string de um número válido",
      }
    )
    .transform((val) => parseInt(val, 10)),
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
});
export const ReposicaoEstoqueSchema = z.object({
  produtoId: z
    .string({
      required_error: "produtoId é obrigatório",
      invalid_type_error: "produtoId deve ser uma string",
    })
    .transform((val) => parseInt(val, 10)),
  quantidade: z
    .string({
      required_error: "quantidade é obrigatório",
      invalid_type_error: "quantidade deve ser uma string",
    })
    .refine(
      (val) => {
        const regex = /^[0-9]+(,[0-9]{1,2})?$/;
        return regex.test(val);
      },
      {
        message: "quantidade deve ser uma string de um número válido",
      }
    )
    .transform((val) => parseInt(val, 10)),
  custo: z
    .string({
      invalid_type_error: "custo deve ser uma string",
    })
    .transform((val) => parseFloat(val.replace(",", "."))),
  desconto: moneyFormatter("desconto deve ser uma string").optional(),
  frete: moneyFormatter("frete deve ser uma string").optional(),
  notaFiscal: z
    .string({
      invalid_type_error: "notaFiscal deve ser uma string",
    })
    .nullable()
    .transform((val) => (val ? val : null))
    .optional(),
  fornecedor: intNumberFormatter("fornecedor deve ser uma string").optional(),
});
