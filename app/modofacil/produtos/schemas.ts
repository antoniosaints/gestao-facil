import { z } from "zod";
import Decimal from "decimal.js";

export function decimalField(scale: number, integers: number, positive = false, signed = false) {
  return z.union([z.string().max(32).regex(signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/, "Use decimal com ponto, sem agrupamento."), z.number().finite()])
    .refine(value => {
      try {
        const n = new Decimal(value);
        return n.isFinite() && (signed || n.gte(0)) && (!positive || n.gt(0)) && n.abs().lt(new Decimal(10).pow(integers)) && n.decimalPlaces() <= scale;
      } catch { return false; }
    }, `Valor inválido: máximo ${integers} dígitos inteiros e ${scale} casas decimais.`)
    .transform(value => new Decimal(value).toNumber());
}

export const money = decimalField(2, 8);
export const quantity = decimalField(3, 9);
const fields = {
  nome: z.string().trim().min(2).max(191),
  categoriaId: z.number().int().positive().nullable(),
  unidade: z.string().trim().min(1).max(191),
  preco: money,
  precoCompra: money.nullable(),
  minimo: quantity,
  descricao: z.string().max(65535).nullable(),
};
export const criarProdutoSchema = z.object({
  ...fields,
  categoriaId: fields.categoriaId.default(null),
  precoCompra: fields.precoCompra.default(null),
  descricao: fields.descricao.default(null),
  estoque: quantity,
  chaveOperacao: z.string().uuid(),
}).strict();
export const editarProdutoSchema = z.object(fields).partial().strict()
  .refine(data => Object.keys(data).length > 0, "Informe ao menos um campo.");

export const reposicaoSchema = z.object({
  produtoId: z.number().int().positive(),
  quantidade: decimalField(3, 9, true),
  custo: money,
  frete: money.nullable().optional(),
  desconto: money.nullable().optional(),
  fornecedor: z.number().int().positive().nullable().optional(),
  notaFiscal: z.string().max(191).nullable().optional(),
  data: z.string().datetime({ offset: true }).transform(value => new Date(value)).optional(),
}).strict();
export const descarteSchema = z.object({
  produtoId: z.number().int().positive(),
  quantidade: decimalField(3, 9, true),
  motivo: z.string().trim().min(1).max(191),
}).strict();
