import { z } from "zod";

const metodoPagamentoValues = [
  "PIX",
  "DINHEIRO",
  "CARTAO",
  "CREDIARIO",
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
  // Contagem opcional por método (usado pelo PDV PRO). Dinheiro segue em valorFechamento.
  metodosContados: z
    .array(
      z.object({
        metodo: z.string(),
        esperado: z.number(),
        contado: z.number(),
        diferenca: z.number(),
      })
    )
    .optional(),
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
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
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
  crediarioParcelas: z.number().int().min(1).max(36).nullable().optional(),
  crediarioPrimeiroVencimento: z
    .string()
    .nullable()
    .optional()
    .refine((val) => !val || !Number.isNaN(Date.parse(val)), {
      message: "Data da primeira parcela invalida",
    }),
  itens: z.array(vendaItemSchema).min(1, "Informe ao menos um item"),
}).superRefine((data, ctx) => {
  if (data.pagamento !== "CREDIARIO") return;

  if (!data.crediarioParcelas || data.crediarioParcelas < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["crediarioParcelas"],
      message: "Informe em quantas vezes sera o crediario.",
    });
  }

  if (!data.crediarioPrimeiroVencimento) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["crediarioPrimeiroVencimento"],
      message: "Informe a data da primeira parcela do crediario.",
    });
  }
});

