import { z } from "zod";

export const ProdutoSchema = z.object({
  id: z.string().transform((val) => parseInt(val, 10)).optional(),
  contaId: z.string().transform((val) => parseInt(val, 10)).optional(),
  nome: z.string().min(2).trim(),
  descricao: z.string().optional(),
  preco: z.string().transform((val) => parseFloat(val.replace(',', '.'))),
  estoque: z.string().transform((val) => parseInt(val, 10)),
  minimo: z.string().transform((val) => parseInt(val, 10)),
  precoCompra: z.string().transform((val) => parseFloat(val.replace(',', '.'))).optional(),
  unidade: z.string().optional(),
  codigo: z.string().optional(),
  entradas: z.boolean(),
  saidas: z.boolean(),
});
export const ReposicaoEstoqueSchema = z.object({
  produtoId: z.string().transform((val) => parseInt(val, 10)),
  quantidade: z.string().transform((val) => parseInt(val, 10)),
  custo: z.string().transform((val) => parseFloat(val.replace(',', '.'))),
});
