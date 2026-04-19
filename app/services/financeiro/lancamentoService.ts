import { Decimal } from 'decimal.js'
import dayjs from 'dayjs'
import { addDays, startOfDay } from 'date-fns'
import type { Prisma, PrismaClient } from '../../../generated/client'
import { gerarIdUnicoComMetaFinal } from '../../helpers/generateUUID'
import { enqueuePushNotification } from '../pushNotificationQueueService'
import { formatCurrency } from '../../utils/formatters'

export type TipoLancamentoModo = 'AVISTA' | 'PARCELADO'
export type PeriodoParcelamento = 'MENSAL' | 'SEMANAL' | 'DIARIO' | 'QUINZENAL' | 'PERSONALIZADO'
export type ModoValorParcelamento = 'TOTAL' | 'FIXO_PARCELA'
export type EscopoAtualizacaoParcela =
  | 'ATUAL'
  | 'TODAS'
  | 'PENDENTES'
  | 'PAGAS'
  | 'ATUAL_EM_DIANTE'
  | 'ATUAL_PARA_TRAS'

export type LancamentoFinanceiroPayload = {
  descricao: string
  valorTotal: number | string
  valorEntrada?: number | string
  dataEntrada?: string | Date | null
  desconto?: number | string
  tipoLancamentoModo?: TipoLancamentoModo
  lancamentoEfetivado?: boolean
  tipo: 'RECEITA' | 'DESPESA'
  formaPagamento:
    | 'DINHEIRO'
    | 'DEBITO'
    | 'CREDITO'
    | 'BOLETO'
    | 'DEPOSITO'
    | 'TRANSFERENCIA'
    | 'CHEQUE'
    | 'PIX'
  status?: 'PENDENTE' | 'PAGO' | 'ATRASADO' | 'PARCIAL'
  clienteId?: number | string | null
  categoriaId: number | string
  dataLancamento: string | Date
  parcelas?: number | string
  contasFinanceiroId: number | string
  periodoParcelamento?: PeriodoParcelamento
  intervaloDiasPersonalizado?: number | string | null
  modoValorParcelamento?: ModoValorParcelamento
}

type DbClient = Prisma.TransactionClient | PrismaClient

type ValoresCalculados = {
  valorBrutoTotal: Decimal
  valorTotalDecimal: Decimal
  valorEntradaDecimal: Decimal
  descontoDecimal: Decimal
  valorParcelado: Decimal
  valoresParcelas: Decimal[]
  totalParcelas: number
  recorrente: boolean
  hasEfetivadoTotal: boolean
  periodoParcelamento: PeriodoParcelamento
  intervaloDiasPersonalizado: number | null
  modoValorParcelamento: ModoValorParcelamento
  tipoLancamentoModo: TipoLancamentoModo
}

function parseDecimal(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return new Decimal(0)
  return new Decimal(value)
}

function parsePositiveInt(value: number | string | null | undefined, fallback: number) {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('Número de parcelas deve ser de 1 ou mais.')
  }
  return parsed
}

export function normalizePeriodoParcelamento(
  periodo?: string | null,
): PeriodoParcelamento {
  if (
    periodo === 'MENSAL' ||
    periodo === 'SEMANAL' ||
    periodo === 'DIARIO' ||
    periodo === 'QUINZENAL' ||
    periodo === 'PERSONALIZADO'
  ) {
    return periodo
  }

  return 'MENSAL'
}

export function normalizeModoValorParcelamento(
  modo?: string | null,
): ModoValorParcelamento {
  if (modo === 'FIXO_PARCELA') return 'FIXO_PARCELA'
  return 'TOTAL'
}

export function normalizeTipoLancamentoModo(
  modo?: string | null,
): TipoLancamentoModo {
  if (modo === 'PARCELADO') return 'PARCELADO'
  return 'AVISTA'
}

export function calcularProximoVencimento(
  dataBase: string | Date,
  indiceParcela: number,
  periodo: PeriodoParcelamento,
  intervaloPersonalizado?: number | null,
) {
  const base = dayjs(dataBase)

  if (!base.isValid()) {
    throw new Error('Data de lançamento inválida.')
  }

  if (indiceParcela <= 0) {
    return startOfDay(base.toDate())
  }

  switch (periodo) {
    case 'DIARIO':
      return startOfDay(base.add(indiceParcela, 'day').toDate())
    case 'SEMANAL':
      return startOfDay(base.add(indiceParcela, 'week').toDate())
    case 'QUINZENAL':
      return startOfDay(base.add(indiceParcela * 15, 'day').toDate())
    case 'PERSONALIZADO': {
      const intervalo = Number(intervaloPersonalizado || 0)
      if (!Number.isInteger(intervalo) || intervalo < 1) {
        throw new Error('Informe um intervalo personalizado em dias válido.')
      }
      return startOfDay(base.add(indiceParcela * intervalo, 'day').toDate())
    }
    case 'MENSAL':
    default:
      return startOfDay(base.add(indiceParcela, 'month').toDate())
  }
}

function distribuirValorTotalEmParcelas(total: Decimal, parcelas: number) {
  if (parcelas <= 0) return []

  const base = total.dividedBy(parcelas).toDecimalPlaces(2)
  const valores = Array.from({ length: parcelas }, () => base)
  const totalBase = base.times(parcelas)
  const diferenca = total.minus(totalBase)

  if (!diferenca.isZero()) {
    valores[valores.length - 1] = valores[valores.length - 1].plus(diferenca)
  }

  return valores
}

export function validarPayloadLancamento(payload: LancamentoFinanceiroPayload) {
  const tipoLancamentoModo = normalizeTipoLancamentoModo(payload.tipoLancamentoModo)
  const modoValorParcelamento = normalizeModoValorParcelamento(payload.modoValorParcelamento)
  const totalParcelas = parsePositiveInt(payload.parcelas, 1)
  const valorInformado = parseDecimal(payload.valorTotal)
  const valorEntrada = parseDecimal(payload.valorEntrada)
  const desconto = parseDecimal(payload.desconto)
  const periodoParcelamento = normalizePeriodoParcelamento(payload.periodoParcelamento)
  const intervaloDiasPersonalizado =
    payload.intervaloDiasPersonalizado === null ||
    payload.intervaloDiasPersonalizado === undefined ||
    payload.intervaloDiasPersonalizado === ''
      ? null
      : Number(payload.intervaloDiasPersonalizado)

  if (!payload.descricao || !payload.tipo || !payload.formaPagamento || !payload.categoriaId || !payload.contasFinanceiroId) {
    throw new Error('Campos obrigatórios não preenchidos.')
  }

  if (!payload.dataLancamento || Number.isNaN(new Date(payload.dataLancamento).getTime())) {
    throw new Error('Informe uma data de lançamento válida.')
  }

  if (valorInformado.lte(0)) {
    throw new Error('Informe um valor maior que zero.')
  }

  if (valorEntrada.lt(0)) {
    throw new Error('Valor de entrada inválido.')
  }

  if (desconto.lt(0)) {
    throw new Error('Desconto inválido.')
  }

  if (tipoLancamentoModo === 'AVISTA' && totalParcelas > 1) {
    throw new Error('Lançamentos à vista devem possuir apenas uma parcela.')
  }

  if (tipoLancamentoModo === 'PARCELADO' && totalParcelas < 1) {
    throw new Error('Informe o número de parcelas para o lançamento parcelado.')
  }

  if (valorEntrada.gt(0) && !payload.dataEntrada) {
    throw new Error('Data de entrada precisa ser informada quando existe um valor de entrada.')
  }

  if (payload.dataEntrada && Number.isNaN(new Date(payload.dataEntrada).getTime())) {
    throw new Error('Informe uma data de entrada válida.')
  }

  if (tipoLancamentoModo === 'PARCELADO' && periodoParcelamento === 'PERSONALIZADO') {
    if (!Number.isInteger(intervaloDiasPersonalizado) || Number(intervaloDiasPersonalizado) < 1) {
      throw new Error('Informe a quantidade de dias do parcelamento personalizado.')
    }
  }

  if (tipoLancamentoModo === 'PARCELADO' && modoValorParcelamento === 'FIXO_PARCELA' && desconto.gt(0)) {
    throw new Error('Desconto não é compatível com o modo de valor fixo por parcela.')
  }
}

export function calcularValoresLancamento(
  payload: LancamentoFinanceiroPayload,
): ValoresCalculados {
  validarPayloadLancamento(payload)

  const tipoLancamentoModo = normalizeTipoLancamentoModo(payload.tipoLancamentoModo)
  const modoValorParcelamento = normalizeModoValorParcelamento(payload.modoValorParcelamento)
  const totalParcelas = tipoLancamentoModo === 'AVISTA' ? 1 : parsePositiveInt(payload.parcelas, 1)
  const valorInformado = parseDecimal(payload.valorTotal)
  const valorEntradaDecimal = parseDecimal(payload.valorEntrada)
  const descontoDecimal = parseDecimal(payload.desconto)
  const periodoParcelamento =
    tipoLancamentoModo === 'PARCELADO'
      ? normalizePeriodoParcelamento(payload.periodoParcelamento)
      : 'MENSAL'
  const intervaloDiasPersonalizado =
    payload.intervaloDiasPersonalizado === null ||
    payload.intervaloDiasPersonalizado === undefined ||
    payload.intervaloDiasPersonalizado === ''
      ? null
      : Number(payload.intervaloDiasPersonalizado)
  const hasEfetivadoTotal = Boolean(payload.lancamentoEfetivado)

  let valorBrutoTotal = valorInformado
  let valorTotalDecimal = valorInformado.minus(descontoDecimal)
  let valorParcelado = valorTotalDecimal.minus(valorEntradaDecimal)
  let valoresParcelas = distribuirValorTotalEmParcelas(valorParcelado, totalParcelas)

  if (tipoLancamentoModo === 'PARCELADO' && modoValorParcelamento === 'FIXO_PARCELA') {
    const valorFixoParcela = valorInformado.toDecimalPlaces(2)
    valoresParcelas = Array.from({ length: totalParcelas }, () => valorFixoParcela)
    valorParcelado = valorFixoParcela.times(totalParcelas)
    valorBrutoTotal = valorParcelado.plus(valorEntradaDecimal)
    valorTotalDecimal = valorBrutoTotal
  }

  if (valorTotalDecimal.lte(0)) {
    throw new Error('O valor final do lançamento deve ser maior que zero.')
  }

  if (valorEntradaDecimal.gt(valorTotalDecimal)) {
    throw new Error('Valor de entrada maior que o valor total.')
  }

  if (valorParcelado.lt(0)) {
    throw new Error('O valor parcelado não pode ser negativo.')
  }

  return {
    valorBrutoTotal,
    valorTotalDecimal,
    valorEntradaDecimal,
    descontoDecimal,
    valorParcelado,
    valoresParcelas,
    totalParcelas,
    recorrente: tipoLancamentoModo === 'PARCELADO' || totalParcelas > 1,
    hasEfetivadoTotal,
    periodoParcelamento,
    intervaloDiasPersonalizado,
    modoValorParcelamento,
    tipoLancamentoModo,
  }
}

export async function criarLancamentoFinanceiro(
  db: DbClient,
  contaId: number,
  payload: LancamentoFinanceiroPayload,
  options?: {
    skipNotification?: boolean
  },
) {
  const {
    descricao,
    tipo,
    formaPagamento,
    status,
    clienteId,
    categoriaId,
    dataLancamento,
    dataEntrada = null,
    contasFinanceiroId,
  } = payload

  const {
    valorBrutoTotal,
    valorTotalDecimal,
    valorEntradaDecimal,
    descontoDecimal,
    valoresParcelas,
    totalParcelas,
    recorrente,
    hasEfetivadoTotal,
    periodoParcelamento,
    intervaloDiasPersonalizado,
  } = calcularValoresLancamento(payload)

  const novoLancamento = await db.lancamentoFinanceiro.create({
    data: {
      descricao,
      Uid: gerarIdUnicoComMetaFinal('FIN'),
      valorTotal: valorTotalDecimal,
      valorEntrada: valorEntradaDecimal,
      dataEntrada: dataEntrada ? startOfDay(new Date(dataEntrada)) : null,
      valorBruto: valorBrutoTotal,
      desconto: descontoDecimal,
      tipo,
      formaPagamento,
      status: hasEfetivadoTotal ? 'PAGO' : status || 'PENDENTE',
      clienteId: Number(clienteId) || null,
      categoriaId: Number(categoriaId),
      contaId,
      recorrente,
      contasFinanceiroId: Number(contasFinanceiroId) || null,
      dataLancamento: startOfDay(new Date(dataLancamento)),
    },
  })

  if (valorEntradaDecimal.gt(0) && dataEntrada) {
    await db.parcelaFinanceiro.create({
      data: {
        Uid: gerarIdUnicoComMetaFinal('PAR'),
        numero: 0,
        valor: valorEntradaDecimal,
        vencimento: startOfDay(new Date(dataEntrada)),
        pago: true,
        valorPago: valorEntradaDecimal,
        dataPagamento: startOfDay(new Date(dataEntrada)),
        formaPagamento,
        lancamentoId: novoLancamento.id,
        contaFinanceira: Number(contasFinanceiroId) || null,
      },
    })
  }

  if (totalParcelas > 0) {
    await db.parcelaFinanceiro.createMany({
      data: valoresParcelas.map((valorParcela, index) => {
        const vencimento = calcularProximoVencimento(
          dataLancamento,
          index,
          periodoParcelamento,
          intervaloDiasPersonalizado,
        )

        return {
          Uid: gerarIdUnicoComMetaFinal('PAR'),
          numero: index + 1,
          valor: valorParcela,
          pago: hasEfetivadoTotal,
          valorPago: hasEfetivadoTotal ? valorParcela : null,
          formaPagamento: hasEfetivadoTotal ? formaPagamento : null,
          dataPagamento: hasEfetivadoTotal ? vencimento : null,
          vencimento,
          lancamentoId: novoLancamento.id,
          contaFinanceira: Number(contasFinanceiroId) || null,
        }
      }),
    })
  }

  if (!options?.skipNotification) {
    await enqueuePushNotification(
      {
        title: 'Lançamento criado.',
        body: `${tipo}: ${descricao}, no valor de ${formatCurrency(valorTotalDecimal)}`,
      },
      contaId,
    )
  }

  return {
    id: novoLancamento.id,
    valorTotal: valorTotalDecimal,
    lancamento: novoLancamento,
  }
}

export function filtrarParcelasPorEscopo<T extends { id: number; numero: number; pago: boolean }>(
  parcelas: T[],
  parcelaAtualId: number,
  escopo: EscopoAtualizacaoParcela,
) {
  const atual = parcelas.find((item) => item.id === parcelaAtualId)

  if (!atual) {
    return [] as T[]
  }

  switch (escopo) {
    case 'TODAS':
      return parcelas
    case 'PENDENTES':
      return parcelas.filter((item) => !item.pago)
    case 'PAGAS':
      return parcelas.filter((item) => item.pago)
    case 'ATUAL_EM_DIANTE':
      return parcelas.filter((item) => item.numero >= atual.numero)
    case 'ATUAL_PARA_TRAS':
      return parcelas.filter((item) => item.numero <= atual.numero)
    case 'ATUAL':
    default:
      return parcelas.filter((item) => item.id === parcelaAtualId)
  }
}

export function aplicarDeslocamentoData(baseDate: Date | string, diffInDays: number) {
  return startOfDay(addDays(new Date(baseDate), diffInDays))
}
