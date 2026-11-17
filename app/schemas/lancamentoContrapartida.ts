import { z } from "zod";
import Decimal from "decimal.js";

const id = z
  .union([
    z.number().int().positive(),
    z.string().regex(/^\d+$/).transform(Number),
  ])
  .refine(
    (value) => Number.isSafeInteger(value) && value > 0,
    "Identificação inválida.",
  );
const money = z
  .union([
    z.number().finite(),
    z
      .string()
      .max(32)
      .regex(/^\d+(\.\d+)?$/),
  ])
  .refine((value) => {
    const number = new Decimal(value);
    return number.gte(0) && number.lt(1e10) && number.decimalPlaces() <= 2;
  }, "Informe um valor válido, com até duas casas decimais.");
const date = z.string().datetime({ offset: true }).or(z.string().date());
const positiveInt = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().positive());

export const lancamentoContrapartidaSchema = z
  .object({
    chaveOperacao: z.string().uuid(),
    descricao: z.string().trim().min(1).max(191),
    tipo: z.enum(["RECEITA", "DESPESA"]),
    categoriaId: id,
    clienteId: id.nullable().optional(),
    contasFinanceiroId: id.nullable().optional(),
    valorTotal: money.refine(
      (value) => new Decimal(value).gt(0),
      "O valor deve ser maior que zero.",
    ),
    desconto: money.optional(),
    valorEntrada: money.optional(),
    dataEntrada: date.nullable().optional(),
    dataLancamento: date,
    formaPagamento: z.enum([
      "DINHEIRO",
      "DEBITO",
      "CREDITO",
      "BOLETO",
      "DEPOSITO",
      "TRANSFERENCIA",
      "CHEQUE",
      "PIX",
    ]),
    lancamentoEfetivado: z.boolean(),
    tipoLancamentoModo: z
      .enum(["AVISTA", "PARCELADO", "RECORRENTE"])
      .default("AVISTA"),
    parcelas: positiveInt.pipe(z.number().max(360)).optional(),
    periodoParcelamento: z
      .enum(["MENSAL", "SEMANAL", "DIARIO", "QUINZENAL", "PERSONALIZADO"])
      .optional(),
    intervaloDiasPersonalizado: positiveInt.nullable().optional(),
    modoValorParcelamento: z.enum(["TOTAL", "FIXO_PARCELA"]).optional(),
    notificarVencimento: z.boolean().optional(),
    notificarClienteVencimento: z.boolean().optional(),
    ignorado: z.boolean().optional(),
    recorrencia: z
      .object({
        frequencia: z.enum([
          "DIARIO",
          "SEMANAL",
          "QUINZENAL",
          "MENSAL",
          "TRIMESTRAL",
          "SEMESTRAL",
          "ANUAL",
          "PERSONALIZADO",
        ]),
        intervaloDias: positiveInt.nullable().optional(),
        dataInicio: date.nullable().optional(),
        dataFim: date.nullable().optional(),
        minimoGerado: positiveInt.pipe(z.number().max(24)),
        maximoEmAberto: positiveInt.pipe(z.number().max(60)),
        geracaoAutomatica: z.boolean(),
        diasAntecedencia: z.number().int().min(0).max(365),
      })
      .strict()
      .optional(),
  })
  .strict();

export type LancamentoContrapartidaInput = z.infer<
  typeof lancamentoContrapartidaSchema
>;
