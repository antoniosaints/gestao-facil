import { z } from "zod";

const name = z.string().trim().min(1).max(180);
const money = z.number().finite().min(0).max(99999999.99).multipleOf(0.01);
const quantity = z.number().finite().min(0).max(9999999.999).multipleOf(0.001);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return (
      !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    );
  }, "Data inválida");
export const writeSchemas = {
  createClienteNovo: z
    .object({
      nome: name,
      endereco: z.string().max(500).optional(),
      email: z.string().email().max(200).optional(),
      telefone: z.string().max(30).optional(),
      documento: z.string().max(30).optional(),
    })
    .strict(),
  createServicoNovo: z.object({ servico: name, preco: money }).strict(),
  createProdutoNovo: z
    .object({
      nome: name,
      preco: money,
      estoque: quantity.default(0),
      minimo: quantity.default(0),
    })
    .strict(),
  createReposicaoEstoqueProduto: z
    .object({
      idProduto: z.number().int().positive(),
      quantidade: quantity.positive(),
      valor: money.optional(),
      nota: z.string().max(180).optional(),
    })
    .strict(),
  createLancamentoFinanceiro: z
    .object({
      descricao: name,
      valor: money.positive(),
      tipo: z.enum(["RECEITA", "DESPESA"]),
      categoria: name.default("Geral"),
      formaPagamento: z
        .enum([
          "PIX",
          "DINHEIRO",
          "CARTAO",
          "BOLETO",
          "TRANSFERENCIA",
          "CHEQUE",
          "CREDITO",
          "DEBITO",
          "OUTRO",
        ])
        .default("DINHEIRO"),
      pago: z.boolean().default(false),
      contaFinanceiraId: z.number().int().positive().optional(),
      contaFinanceira: name.optional(),
      data: date.optional(),
    })
    .strict(),
  createVendaNova: z
    .object({
      cliente: name.optional(),
      clienteId: z.number().int().positive().optional(),
      itens: z
        .array(
          z
            .object({
              nome: name,
              id: z.number().int().positive().optional(),
              tipo: z.enum(["PRODUTO", "SERVICO"]),
              quantidade: quantity
                .int("A quantidade da venda deve ser inteira")
                .positive(),
              preco: money.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(30),
      desconto: money.default(0),
      observacoes: z.string().max(1000).optional(),
      data: date.optional(),
      pagamento: z
        .enum([
          "PIX",
          "DINHEIRO",
          "CARTAO",
          "TRANSFERENCIA",
          "CHEQUE",
          "CREDITO",
          "DEBITO",
          "BOLETO",
          "OUTRO",
        ])
        .default("OUTRO"),
    })
    .strict(),
};
export type WriteToolName = keyof typeof writeSchemas;
export function isWriteTool(name: string): name is WriteToolName {
  return Object.prototype.hasOwnProperty.call(writeSchemas, name);
}
// Unknown/new writes fail closed, even if a developer adds a declaration without a review schema.
export function requiredToolPermission(name: string) {
  if (/Reposicao/.test(name)) return 4;
  if (
    /Produto|Financeiro|Lancamento|Demonstrativo|Categoria|FluxoCaixa/.test(
      name,
    )
  )
    return 3;
  return 2;
}
export function validateWrite(
  name: WriteToolName,
  args: unknown,
): Record<string, any> {
  return writeSchemas[name].parse(args);
}
