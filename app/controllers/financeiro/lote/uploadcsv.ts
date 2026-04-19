import type { Request, Response } from 'express'
import { getCustomRequest } from '../../../helpers/getCustomRequest'
import {
  gerarCsvBaseLancamentos,
  importarLancamentosCsv,
} from '../../../services/financeiro/lancamentoLoteService'

export function getCsvBaseLancamentos(req: Request, res: Response) {
  const csv = gerarCsvBaseLancamentos()
  res.setHeader('Content-Disposition', 'attachment; filename=lancamentos_base.csv')
  res.setHeader('Content-Type', 'text/csv')
  res.send(csv)
}

export async function postImportarLancamentos(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    res.status(400).json({ message: 'Arquivo CSV é obrigatório.' })
    return
  }

  const customData = getCustomRequest(req).customData

  try {
    const resultado = await importarLancamentosCsv(req.file.path, customData.contaId)
    res.json({ sucesso: true, ...resultado })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Erro ao processar CSV de lançamentos.' })
  }
}
