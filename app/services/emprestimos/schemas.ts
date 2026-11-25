import { z } from "zod";
import { MetodoPagamento } from "../../../generated";
import { validarCpfCnpj } from "../../helpers/formatters";
import { dataValida } from "./policy";

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.").refine(dataValida, "Informe uma data válida.");
const forma = z.nativeEnum(MetodoPagamento);
const chave = z.string().uuid("Não foi possível identificar a operação. Reabra o formulário e tente novamente.");
const percentual = z.number().int().min(0).max(10_000);
export const valorMaximoPagamento = 2_147_483_647;
const parcelas = z.array(id).min(1, "Selecione pelo menos uma parcela.").max(120)
  .refine((ids) => new Set(ids).size === ids.length, "Selecione cada parcela apenas uma vez.");

const dataFiltro = z.preprocess((valor) => valor === "" ? undefined : valor, data.optional());
export const filtrosTabelaSchema = z.object({
  situacao: z.enum(["TODOS", "EM_ANDAMENTO", "EM_ATRASO", "QUITADO", "COMPROVANTE_EM_ANALISE"], {
    errorMap: () => ({ message: "Selecione uma situação de empréstimo válida." }),
  }).default("TODOS"),
  inicioVencimento: dataFiltro,
  fimVencimento: dataFiltro,
}).refine(
  ({ inicioVencimento, fimVencimento }) => !inicioVencimento || !fimVencimento || inicioVencimento <= fimVencimento,
  { path: ["fimVencimento"], message: "O vencimento final deve ser a partir do inicial." },
);

export type FiltrosTabelaEmprestimos = z.infer<typeof filtrosTabelaSchema>;

const termosEmprestimo = z.object({
  principalCentavos: id.max(100_000_000),
  dataSaida: data,
  primeiroVencimento: data,
  jurosBps: z.number().int().min(0).max(100_000),
  jurosMoraBps: percentual.default(0),
  multaBps: percentual.default(0),
  descontoFixoCentavos: z.number().int().min(0).max(100_000_000).default(0),
  descontoJurosBps: percentual.nullable().optional(),
  antecipacaoParcelaBps: percentual.default(0),
  antecipacaoParcelaCentavos: z.number().int().min(0).max(100_000_000).default(0),
  numeroParcelas: id.max(120),
});

function validarTermos(input: z.infer<typeof termosEmprestimo>, ctx: z.RefinementCtx) {
  if (input.primeiroVencimento < input.dataSaida) {
    ctx.addIssue({ code: "custom", path: ["primeiroVencimento"], message: "O vencimento deve ser a partir da data da saída." });
  }
  if (input.principalCentavos < input.numeroParcelas) {
    ctx.addIssue({ code: "custom", path: ["numeroParcelas"], message: "O principal deve ter pelo menos um centavo por parcela." });
  }
  if (input.descontoFixoCentavos > 0 && input.principalCentavos - input.descontoFixoCentavos < input.numeroParcelas) {
    ctx.addIssue({ code: "custom", path: ["descontoFixoCentavos"], message: "O desconto deve deixar pelo menos um centavo de principal por parcela." });
  }
  if ([input.descontoJurosBps, input.antecipacaoParcelaBps, input.antecipacaoParcelaCentavos].filter(Boolean).length > 1) {
    ctx.addIssue({ code: "custom", path: ["antecipacaoParcelaBps"], message: "Escolha uma única regra de desconto por antecipação." });
  }
}

export const diasSimulacaoSchema = z.object({
  dias: z.number().int().min(-3650).max(3650),
});
export const simularCriacaoSchema = termosEmprestimo.merge(diasSimulacaoSchema).superRefine(validarTermos);

export const criarSchema = termosEmprestimo.extend({
  chaveOperacao: chave,
  clienteId: id,
  formaSaida: forma,
  contaSaidaId: id.nullable(),
  contaEntradaId: id.nullable(),
  categoriaId: id.nullable(),
  lancamentoAutomatico: z.boolean(),
}).superRefine((input, ctx) => {
  function erro(path: string, message: string) {
    ctx.addIssue({ code: "custom", path: [path], message });
  }
  validarTermos(input, ctx);
  if (input.lancamentoAutomatico && !input.contaEntradaId) erro("contaEntradaId", "Selecione a conta dos recebimentos.");
  if ((input.contaSaidaId || input.lancamentoAutomatico) && !input.categoriaId) erro("categoriaId", "Selecione a categoria do lançamento.");
});

export const configSchema = z.object({
  pixManual: z.boolean(),
  mercadoPago: z.boolean(),
  descontoJurosBps: percentual,
});

export const cotacaoSchema = z.object({
  parcelas,
  recebidoEm: data,
});

export const baixaSchema = cotacaoSchema.extend({
  chaveOperacao: chave,
  totalCentavos: id.max(valorMaximoPagamento).optional(),
  formaRecebimento: forma,
  lancarNoFinanceiro: z.boolean(),
  contaEntradaId: id.nullable().optional(),
  categoriaId: id.nullable().optional(),
});

export const aprovarSchema = baixaSchema.pick({
  recebidoEm: true, lancarNoFinanceiro: true, contaEntradaId: true, categoriaId: true,
});

export const pagamentoSchema = z.object({ parcelas, totalCentavos: id.max(valorMaximoPagamento) }).and(z.discriminatedUnion("metodo", [
  z.object({ metodo: z.literal("PIX_MANUAL") }),
  z.object({
    metodo: z.literal("MERCADO_PAGO"),
    email: z.string().trim().email("Informe um e-mail válido.").max(191),
    documento: z.string().max(24).transform((value) => value.replace(/\D/g, ""))
      .refine((value) => validarCpfCnpj(value), "Informe o CPF ou CNPJ do pagador."),
  }),
]));

export type CriarEmprestimo = z.infer<typeof criarSchema>;
export type SimularCriacao = z.infer<typeof simularCriacaoSchema>;
export type ConfigEmprestimo = z.infer<typeof configSchema>;
export type BaixaEmprestimo = z.infer<typeof baixaSchema>;
export type CotacaoBaixa = z.infer<typeof cotacaoSchema>;
export type ConfirmacaoEmprestimo = z.infer<typeof aprovarSchema>;
export type AbrirPagamento = z.infer<typeof pagamentoSchema>;
