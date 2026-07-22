import { Request, Response } from "express";
import { startOfDay } from "date-fns";

import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { sendFinanceiroUpdated } from "../../hooks/financeiro/socket";
import { atualizarStatusLancamentos } from "./hooks";
import {
  avancarDataRecorrencia,
  normalizarConfigRecorrencia,
} from "../../services/financeiro/lancamentoRecorrenciaPolicy";
import {
  gerarParcelasRecorrentes,
  type ResultadoGeracaoRecorrencia,
} from "../../services/financeiro/lancamentoRecorrenciaService";

const MENSAGEM_POR_MOTIVO: Record<ResultadoGeracaoRecorrencia["motivo"], string> = {
  OK: "Próxima ocorrência gerada.",
  SEM_RECORRENCIA: "Este lançamento não possui recorrência configurada.",
  RECORRENCIA_INATIVA: "A recorrência está pausada. Retome-a para gerar novas ocorrências.",
  RECORRENCIA_ENCERRADA: "A recorrência já foi encerrada.",
  FIM_ATINGIDO: "A recorrência chegou à data de fim e foi encerrada.",
  MAXIMO_EM_ABERTO: "Limite de parcelas em aberto atingido. Quite as pendentes para gerar novas.",
  ALVO_ATINGIDO: "Já existem parcelas em aberto suficientes para esta recorrência.",
};

async function carregarLancamentoDaConta(id: number, contaId: number) {
  return prisma.lancamentoFinanceiro.findFirst({
    where: { id, contaId },
    select: {
      id: true,
      dataLancamento: true,
      recorrencia: true,
      parcelas: {
        select: { numero: true, vencimento: true, valor: true },
        orderBy: [{ vencimento: "desc" }],
      },
    },
  });
}

/// Cursor da próxima ocorrência a partir do que já existe no lançamento: a maior
/// data de vencimento gerada avança um período; sem parcelas, parte do início.
function resolverProximoVencimento(
  parcelas: Array<{ numero: number; vencimento: Date }>,
  config: { dataInicio: Date; frequencia: any; intervaloDias: number | null; dataFim: Date | null },
) {
  const ultima = parcelas.filter((parcela) => parcela.numero !== 0)[0];
  const proximo = ultima
    ? avancarDataRecorrencia(ultima.vencimento, config.frequencia, config.intervaloDias)
    : startOfDay(config.dataInicio);

  if (config.dataFim && proximo > startOfDay(config.dataFim)) return null;
  return proximo;
}

export const salvarRecorrenciaLancamento = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Informe um lançamento válido." });
    }

    const lancamento = await carregarLancamentoDaConta(id, customData.contaId);

    if (!lancamento) {
      return res.status(404).json({ message: "Lançamento não encontrado." });
    }

    let config;
    try {
      config = normalizarConfigRecorrencia(req.body || {}, {
        dataInicioFallback: lancamento.recorrencia?.dataInicio || lancamento.dataLancamento,
      });
    } catch (error: any) {
      return res.status(400).json({ message: error?.message || "Configuração de recorrência inválida." });
    }

    const valorInformado = req.body?.valorParcela;
    const valorParcela =
      valorInformado === undefined || valorInformado === null || valorInformado === ""
        ? lancamento.recorrencia?.valorParcela ?? lancamento.parcelas[0]?.valor
        : Number(valorInformado);

    if (valorParcela === undefined || valorParcela === null || Number(valorParcela) <= 0) {
      return res.status(400).json({ message: "Informe um valor válido para as ocorrências." });
    }

    const proximoVencimento = resolverProximoVencimento(lancamento.parcelas, config);

    const dados = {
      // Editar a configuração não retoma uma recorrência pausada de propósito.
      ativo: proximoVencimento === null ? false : lancamento.recorrencia?.ativo ?? true,
      valorParcela,
      frequencia: config.frequencia,
      intervaloDias: config.intervaloDias,
      dataInicio: config.dataInicio,
      dataFim: config.dataFim,
      minimoGerado: config.minimoGerado,
      maximoEmAberto: config.maximoEmAberto,
      geracaoAutomatica: config.geracaoAutomatica,
      diasAntecedencia: config.diasAntecedencia,
      proximoVencimento,
      encerradaEm: proximoVencimento === null ? new Date() : null,
    };

    await prisma.lancamentoRecorrencia.upsert({
      where: { lancamentoId: id },
      create: {
        contaId: customData.contaId,
        lancamentoId: id,
        totalGerado: lancamento.parcelas.filter((parcela) => parcela.numero !== 0).length,
        ...dados,
      },
      update: dados,
    });

    const geracao = await prisma.$transaction((tx) => gerarParcelasRecorrentes(tx, id, { modo: "MINIMO" }));

    if (geracao.criadas) {
      await atualizarStatusLancamentos(customData.contaId);
    }

    sendFinanceiroUpdated(customData.contaId, {
      reason: "recorrencia-atualizada",
      lancamentoId: id,
      parcelasGeradas: geracao.criadas,
    });

    const recorrencia = await prisma.lancamentoRecorrencia.findUnique({ where: { lancamentoId: id } });

    return ResponseHandler(res, "Recorrência salva com sucesso.", { recorrencia, geracao });
  } catch (error) {
    handleError(res, error);
  }
};

export const atualizarStatusRecorrenciaLancamento = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const id = Number(req.params.id);
    const encerrar = Boolean(req.body?.encerrar);
    const ativo = Boolean(req.body?.ativo);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Informe um lançamento válido." });
    }

    const lancamento = await carregarLancamentoDaConta(id, customData.contaId);

    if (!lancamento?.recorrencia) {
      return res.status(404).json({ message: "Recorrência não encontrada para este lançamento." });
    }

    const recorrencia = lancamento.recorrencia;

    if (encerrar) {
      const atualizada = await prisma.lancamentoRecorrencia.update({
        where: { id: recorrencia.id },
        data: { ativo: false, proximoVencimento: null, encerradaEm: new Date() },
      });

      sendFinanceiroUpdated(customData.contaId, { reason: "recorrencia-encerrada", lancamentoId: id });

      return ResponseHandler(res, "Recorrência encerrada. As parcelas já geradas seguem em aberto.", atualizada);
    }

    // Ao retomar uma recorrência sem cursor, recalcula a partir da última parcela.
    const proximoVencimento =
      ativo && !recorrencia.proximoVencimento
        ? resolverProximoVencimento(lancamento.parcelas, {
            dataInicio: recorrencia.dataInicio,
            frequencia: recorrencia.frequencia,
            intervaloDias: recorrencia.intervaloDias,
            dataFim: recorrencia.dataFim,
          })
        : recorrencia.proximoVencimento;

    if (ativo && !proximoVencimento) {
      return res.status(400).json({
        message: "A recorrência chegou à data de fim. Ajuste a data de fim antes de retomar.",
      });
    }

    const atualizada = await prisma.lancamentoRecorrencia.update({
      where: { id: recorrencia.id },
      data: {
        ativo,
        proximoVencimento,
        encerradaEm: ativo ? null : recorrencia.encerradaEm,
      },
    });

    sendFinanceiroUpdated(customData.contaId, {
      reason: ativo ? "recorrencia-retomada" : "recorrencia-pausada",
      lancamentoId: id,
    });

    return ResponseHandler(
      res,
      ativo ? "Recorrência retomada." : "Recorrência pausada.",
      atualizada,
    );
  } catch (error) {
    handleError(res, error);
  }
};

export const gerarProximaOcorrenciaRecorrencia = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Informe um lançamento válido." });
    }

    const lancamento = await prisma.lancamentoFinanceiro.findFirst({
      where: { id, contaId: customData.contaId },
      select: { id: true },
    });

    if (!lancamento) {
      return res.status(404).json({ message: "Lançamento não encontrado." });
    }

    const geracao = await prisma.$transaction((tx) => gerarParcelasRecorrentes(tx, id, { modo: "PROXIMA" }));

    if (!geracao.criadas) {
      return res.status(400).json({ message: MENSAGEM_POR_MOTIVO[geracao.motivo] });
    }

    await atualizarStatusLancamentos(customData.contaId);
    sendFinanceiroUpdated(customData.contaId, {
      reason: "recorrencia-parcela-gerada",
      lancamentoId: id,
      parcelasGeradas: geracao.criadas,
    });

    return ResponseHandler(res, MENSAGEM_POR_MOTIVO.OK, geracao);
  } catch (error) {
    handleError(res, error);
  }
};
