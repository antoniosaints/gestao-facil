import { z } from "zod";

const metodoPagamentoValues = [
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
] as const;

const vendaItemSchema = z.object({
  id: z.number().int().positive(),
  tipo: z.enum(["PRODUTO", "SERVICO"]).default("PRODUTO"),
  nome: z.string().optional(),
  preco: z.number(),
  quantidade: z.number().positive(),
});

export const abrirCaixaSchema = z.object({
  pdvId: z.number().int().positive().nullable().optional(),
  valorInicial: z.number().min(0).default(0),
  observacao: z.string().optional(),
});

export const entrarCaixaSchema = z.object({
  caixaId: z.number().int().positive(),
});

export const movimentarCaixaSchema = z.object({
  caixaId: z.number().int().positive(),
  tipoMovimento: z
    .enum(["SANGRIA", "REFORCO", "ENTRADA", "SAIDA"])
    .optional(),
  categoria: z
    .enum(["AJUSTE", "DEVOLUCAO", "REFORCO", "SANGRIA", "OUTROS"])
    .optional(),
  descricao: z.string().optional(),
  valor: z.number().positive(),
});

export const fecharCaixaSchema = z.object({
  caixaId: z.number().int().positive(),
  valorFechamento: z.number().min(0),
  descricao: z.string().optional(),
});

export const criarPdvSchema = z.object({
  nome: z.string().min(1, "Informe o nome do PDV"),
  localizacao: z.string().optional().nullable(),
  descricao: z.string().optional().nullable(),
});

export const caixaRelatorioQuerySchema = z.object({
  inicio: z.string().optional(),
  fim: z.string().optional(),
  caixaId: z.string().optional(),
  usuarioId: z.string().optional(),
  status: z.enum(["ABERTO", "FECHADO", "CANCELADO"]).optional(),
});

export const finalizarVendaPdvSchema = z.object({
  caixaId: z.number().int().positive(),
  clienteId: z.number().int().positive().nullable().optional(),
  data: z
    .string()
    .optional()
    .refine((val) => !val || !Number.isNaN(Date.parse(val)), {
      message: "Data invalida",
    }),
  desconto: z.number().min(0).optional().default(0),
  pagamento: z.enum(metodoPagamentoValues),
  valorRecebido: z.union([z.number(), z.string()]).nullable().optional(),
  itens: z.array(vendaItemSchema).min(1, "Informe ao menos um item"),
});

