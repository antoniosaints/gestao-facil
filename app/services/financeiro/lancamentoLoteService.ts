import fs from 'fs'
import csvParser from 'csv-parser'
import { parse as jsonToCsv } from 'json2csv'
import { TipoCliente } from '../../../generated/client'
import { prisma } from '../../utils/prisma'
import { gerarIdUnicoComMetaFinal } from '../../helpers/generateUUID'
import {
  criarLancamentoFinanceiro,
  normalizeModoValorParcelamento,
  normalizePeriodoParcelamento,
  normalizeTipoLancamentoModo,
  type LancamentoFinanceiroPayload,
} from './lancamentoService'

export type LancamentoCsvRow = {
  descricao?: string
  tipo?: string
  dataLancamento?: string
  valor?: string
  modoValorParcelamento?: string
  tipoLancamentoModo?: string
  parcelas?: string
  periodoParcelamento?: string
  intervaloDiasPersonalizado?: string
  valorEntrada?: string
  dataEntrada?: string
  desconto?: string
  lancamentoEfetivado?: string
  formaPagamento?: string
  cliente?: string
  categoria?: string
  contaFinanceira?: string
}

export type ImportacaoLancamentosResultado = {
  inseridos: number
  erros: Array<{
    linha: number
    erro: string
  }>
}

function parseBooleanLike(value: string | undefined) {
  if (!value) return false
  return ['sim', 'true', '1', 'yes', 'y'].includes(value.trim().toLowerCase())
}

function normalizeTipo(value?: string) {
  const normalized = value?.trim().toUpperCase()
  if (normalized === 'RECEITA' || normalized === 'DESPESA') return normalized
  throw new Error('Tipo inválido. Use RECEITA ou DESPESA.')
}

function normalizeFormaPagamento(value?: string) {
  const normalized = value?.trim().toUpperCase() || 'DINHEIRO'
  const allowed = ['DINHEIRO', 'DEBITO', 'CREDITO', 'BOLETO', 'DEPOSITO', 'TRANSFERENCIA', 'CHEQUE', 'PIX']

  if (!allowed.includes(normalized)) {
    throw new Error(`Forma de pagamento inválida: ${value}`)
  }

  return normalized as LancamentoFinanceiroPayload['formaPagamento']
}

function parseDateOrNull(value?: string) {
  const normalized = value?.trim()
  if (!normalized) return null

  const safeValue = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? `${normalized}T12:00:00`
    : normalized
  const date = new Date(safeValue)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Data inválida: ${value}`)
  }

  return date.toISOString()
}

async function getOrCreateCategoriaId(nome: string, contaId: number) {
  const categoriaExistente = await prisma.categoriaFinanceiro.findFirst({
    where: {
      contaId,
      nome,
    },
    select: { id: true },
  })

  if (categoriaExistente) return categoriaExistente.id

  const categoria = await prisma.categoriaFinanceiro.create({
    data: {
      contaId,
      Uid: gerarIdUnicoComMetaFinal('CAT'),
      nome,
    },
    select: { id: true },
  })

  return categoria.id
}

async function getOrCreateContaFinanceiraId(nome: string, contaId: number) {
  const contaExistente = await prisma.contasFinanceiro.findFirst({
    where: {
      contaId,
      nome,
    },
    select: { id: true },
  })

  if (contaExistente) return contaExistente.id

  const conta = await prisma.contasFinanceiro.create({
    data: {
      contaId,
      Uid: gerarIdUnicoComMetaFinal('CON'),
      nome,
      saldoInicial: 0,
    },
    select: { id: true },
  })

  return conta.id
}

async function getOrCreateClienteId(nome: string, contaId: number, tipo: keyof typeof TipoCliente) {
  const existente = await prisma.clientesFornecedores.findFirst({
    where: {
      contaId,
      nome,
    },
    select: { id: true },
  })

  if (existente) return existente.id

  const cliente = await prisma.clientesFornecedores.create({
    data: {
      contaId,
      Uid: gerarIdUnicoComMetaFinal('CLI'),
      nome,
      tipo: TipoCliente[tipo],
      status: 'ATIVO',
    },
    select: { id: true },
  })

  return cliente.id
}

async function mapRowToPayload(row: LancamentoCsvRow, contaId: number): Promise<LancamentoFinanceiroPayload> {
  const descricao = row.descricao?.trim()
  const categoria = row.categoria?.trim()
  const contaFinanceira = row.contaFinanceira?.trim()
  const dataLancamento = parseDateOrNull(row.dataLancamento)

  if (!descricao || !categoria || !contaFinanceira || !dataLancamento || !row.valor) {
    throw new Error(
      'Campos obrigatórios ausentes: descricao, categoria, contaFinanceira, dataLancamento e valor.',
    )
  }

  const tipo = normalizeTipo(row.tipo)
  const categoriaId = await getOrCreateCategoriaId(categoria, contaId)
  const contasFinanceiroId = await getOrCreateContaFinanceiraId(contaFinanceira, contaId)

  let clienteId: number | null = null
  if (row.cliente?.trim()) {
    clienteId = await getOrCreateClienteId(
      row.cliente.trim(),
      contaId,
      tipo === 'DESPESA' ? 'FORNECEDOR' : 'CLIENTE',
    )
  }

  const parcelasInformadas = Number(row.parcelas || 1)
  const tipoLancamentoModo = row.tipoLancamentoModo?.trim()
    ? normalizeTipoLancamentoModo(row.tipoLancamentoModo)
    : parcelasInformadas > 1
      ? 'PARCELADO'
      : 'AVISTA'
  const modoValorParcelamento = normalizeModoValorParcelamento(row.modoValorParcelamento)
  const parcelas = tipoLancamentoModo === 'PARCELADO' ? parcelasInformadas : 1

  return {
    descricao,
    tipo,
    dataLancamento,
    valorTotal: row.valor,
    modoValorParcelamento,
    tipoLancamentoModo,
    parcelas,
    periodoParcelamento: normalizePeriodoParcelamento(row.periodoParcelamento),
    intervaloDiasPersonalizado: row.intervaloDiasPersonalizado || null,
    valorEntrada: row.valorEntrada || 0,
    dataEntrada: parseDateOrNull(row.dataEntrada),
    desconto: row.desconto || 0,
    lancamentoEfetivado: parseBooleanLike(row.lancamentoEfetivado),
    formaPagamento: normalizeFormaPagamento(row.formaPagamento),
    clienteId,
    categoriaId,
    contasFinanceiroId,
  }
}

export function gerarCsvBaseLancamentos() {
  const fields = [
    'descricao',
    'tipo',
    'dataLancamento',
    'valor',
    'modoValorParcelamento',
    'tipoLancamentoModo',
    'parcelas',
    'periodoParcelamento',
    'intervaloDiasPersonalizado',
    'valorEntrada',
    'dataEntrada',
    'desconto',
    'lancamentoEfetivado',
    'formaPagamento',
    'cliente',
    'categoria',
    'contaFinanceira',
  ]

  const example = [
    {
      descricao: 'Mensalidade de abril',
      tipo: 'RECEITA',
      dataLancamento: '2026-04-20',
      valor: '350.00',
      modoValorParcelamento: 'TOTAL',
      tipoLancamentoModo: 'AVISTA',
      parcelas: '1',
      periodoParcelamento: 'MENSAL',
      intervaloDiasPersonalizado: '',
      valorEntrada: '0',
      dataEntrada: '',
      desconto: '0',
      lancamentoEfetivado: 'nao',
      formaPagamento: 'PIX',
      cliente: 'Cliente Exemplo',
      categoria: 'Receitas recorrentes',
      contaFinanceira: 'Conta principal',
    },
    {
      descricao: 'Compra parcelada de insumos',
      tipo: 'DESPESA',
      dataLancamento: '2026-04-25',
      valor: '125.00',
      modoValorParcelamento: 'FIXO_PARCELA',
      tipoLancamentoModo: 'PARCELADO',
      parcelas: '4',
      periodoParcelamento: 'QUINZENAL',
      intervaloDiasPersonalizado: '',
      valorEntrada: '50.00',
      dataEntrada: '2026-04-25',
      desconto: '0',
      lancamentoEfetivado: 'nao',
      formaPagamento: 'BOLETO',
      cliente: 'Fornecedor Exemplo',
      categoria: 'Compras operacionais',
      contaFinanceira: 'Conta caixa',
    },
    {
      descricao: 'Manutenção programada',
      tipo: 'DESPESA',
      dataLancamento: '2026-04-30',
      valor: '90.00',
      modoValorParcelamento: 'TOTAL',
      tipoLancamentoModo: 'PARCELADO',
      parcelas: '3',
      periodoParcelamento: 'PERSONALIZADO',
      intervaloDiasPersonalizado: '10',
      valorEntrada: '0',
      dataEntrada: '',
      desconto: '10.00',
      lancamentoEfetivado: 'nao',
      formaPagamento: 'TRANSFERENCIA',
      cliente: 'Fornecedor Serviços',
      categoria: 'Serviços de terceiros',
      contaFinanceira: 'Banco digital',
    },
  ]

  return jsonToCsv(example, { fields, delimiter: ';' })
}

export async function importarLancamentosCsv(
  arquivoPath: string,
  contaId: number,
): Promise<ImportacaoLancamentosResultado> {
  return new Promise((resolve, reject) => {
    const rows: LancamentoCsvRow[] = []
    const erros: ImportacaoLancamentosResultado['erros'] = []
    let inseridos = 0

    fs.createReadStream(arquivoPath)
      .pipe(csvParser({ separator: ';' }))
      .on('data', (row: LancamentoCsvRow) => rows.push(row))
      .on('end', async () => {
        try {
          for (const [index, row] of rows.entries()) {
            const linha = index + 2

            try {
              const payload = await mapRowToPayload(row, contaId)
              await prisma.$transaction(async (tx) => {
                await criarLancamentoFinanceiro(tx, contaId, payload, {
                  skipNotification: true,
                })
              })
              inseridos += 1
            } catch (error: any) {
              erros.push({
                linha,
                erro: error?.message || 'Erro ao importar lançamento.',
              })
            }
          }

          if (fs.existsSync(arquivoPath)) {
            fs.unlinkSync(arquivoPath)
          }

          resolve({ inseridos, erros })
        } catch (error) {
          if (fs.existsSync(arquivoPath)) {
            fs.unlinkSync(arquivoPath)
          }
          reject(error)
        }
      })
      .on('error', (error) => {
        if (fs.existsSync(arquivoPath)) {
          fs.unlinkSync(arquivoPath)
        }
        reject(error)
      })
  })
}
