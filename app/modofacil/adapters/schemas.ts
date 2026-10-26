import { z } from "zod";
import { money } from "../produtos/schemas";
import { recorrenciaSchema, servicoFields } from "../operacoes/schemas";

export const servicoSchema = z.object({
  id: z.number().int().positive().optional(),
  ...servicoFields,
}).strict();

const contato = {
  nome: z.string().trim().min(2).max(191),
  telefone: z.string().max(191).nullable().optional(),
  whastapp: z.string().max(191).nullable().optional(),
  email: z.string().email().max(191).nullable().optional(),
};
export const pessoaSchema = z.object({ ...contato, tipo: z.enum(["CLIENTE", "FORNECEDOR"]).default("CLIENTE") }).strict();
export const pessoaPatchSchema = z.object(contato).partial().strict().refine(value => Object.keys(value).length > 0, "Informe algum campo.");
export const lancamentoSchema = z.object({
  chaveOperacao: z.string().uuid(),
  descricao: z.string().trim().min(1).max(191),
  valorTotal: money.refine(n => n > 0),
  tipo: z.enum(["RECEITA", "DESPESA"]),
  categoriaId: z.number().int().positive(),
  contasFinanceiroId: z.number().int().positive().nullable().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  dataLancamento: z.string().datetime({ offset: true }),
  formaPagamento: z.enum(["DINHEIRO", "DEBITO", "CREDITO", "BOLETO", "DEPOSITO", "TRANSFERENCIA", "CHEQUE", "PIX"]),
  lancamentoEfetivado: z.boolean(),
  tipoLancamentoModo: z.enum(["AVISTA", "PARCELADO", "RECORRENTE"]).optional(),
  valorEntrada: money.optional(), dataEntrada: z.string().datetime({ offset: true }).nullable().optional(),
  desconto: money.optional(), parcelas: z.number().int().min(1).max(360).optional(),
  periodoParcelamento: z.enum(["MENSAL", "SEMANAL", "DIARIO", "QUINZENAL", "PERSONALIZADO"]).optional(),
  intervaloDiasPersonalizado: z.number().int().positive().nullable().optional(),
  modoValorParcelamento: z.enum(["TOTAL", "FIXO_PARCELA"]).optional(),
  notificarVencimento: z.boolean().optional(), notificarClienteVencimento: z.boolean().optional(),
  recorrencia: recorrenciaSchema.optional(),
}).strict();

// The legacy basic update clears an omitted clienteId. Make the complete
// editable set explicit rather than pretending it is a PATCH.
export const lancamentoBasicoSchema = z.object({
  descricao: z.string().trim().min(1).max(191),
  dataLancamento: z.string().datetime({ offset: true }),
  categoriaId: z.number().int().positive(),
  contasFinanceiroId: z.number().int().positive(),
  clienteId: z.number().int().positive().nullable(),
  formaPagamento: z.enum(["DINHEIRO", "DEBITO", "CREDITO", "BOLETO", "DEPOSITO", "TRANSFERENCIA", "CHEQUE", "PIX"]),
}).strict();
