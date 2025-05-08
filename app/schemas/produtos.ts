import { z } from "zod";

export const AddProdutoSchema = z.object({
  id: z.number().optional(),
  contaId: z.number().optional(),
  nome: z.string().min(2),
  descricao: z.string().optional(),
  preco: z.number().min(0),
  estoque: z.number().min(0),
  minimo: z.number().min(0),
  precoCompra: z.number().min(0).optional(),
  unidade: z.string().optional(),
  codigo: z.string().optional(),
});
