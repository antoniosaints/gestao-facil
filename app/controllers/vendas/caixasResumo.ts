import { Request, Response } from "express";
import Decimal from "decimal.js";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { CaixaStatus, StatusVenda } from "../../../generated";

/**
 * Resumo de caixas para a dashboard: o estado agora, não um recorte por período.
 *
 * "Tem caixa aberto?" é a primeira pergunta operacional do dia, então este resumo é sempre
 * do instante atual — diferente dos demais blocos da dashboard, que seguem o filtro de período.
 */
export async function getResumoCaixas(req: Request, res: Response): Promise<any> {
  try {
    const contaId = Number(getCustomRequest(req).customData.contaId);

    const abertos = await prisma.caixaSessao.findMany({
      where: { contaId, status: CaixaStatus.ABERTO },
      select: {
        id: true,
        codigo: true,
        abertoEm: true,
        saldoEsperado: true,
        pdv: { select: { nome: true } },
        abertoPor: { select: { nome: true } },
      },
      orderBy: { abertoEm: "asc" },
    });

    const caixaIds = abertos.map((c) => c.id);

    // Vendas do turno = vendas já faturadas vinculadas aos caixas abertos agora. Orçamentos
    // não entram: ainda não são dinheiro no caixa.
    const vendasTurno = caixaIds.length
      ? await prisma.vendas.findMany({
          where: {
            contaId,
            caixaId: { in: caixaIds },
            status: { in: [StatusVenda.FATURADO, StatusVenda.FINALIZADO] },
          },
          select: { valor: true },
        })
      : [];

    const totalVendasTurno = vendasTurno.reduce((acc, v) => acc.add(v.valor), new Decimal(0));
    const saldoEsperado = abertos.reduce((acc, c) => acc.add(c.saldoEsperado), new Decimal(0));

    const agora = Date.now();

    return res.json({
      caixasAbertos: abertos.length,
      saldoEsperado: saldoEsperado.toNumber(),
      vendasNoTurno: vendasTurno.length,
      totalVendasNoTurno: totalVendasTurno.toNumber(),
      // Há quanto tempo o caixa mais antigo está aberto: caixa esquecido aberto é um problema
      // comum e não aparece em nenhum outro lugar do sistema.
      abertoHaMaisTempoMs: abertos.length ? agora - abertos[0].abertoEm.getTime() : null,
      caixas: abertos.map((c) => ({
        id: c.id,
        codigo: c.codigo,
        pdv: c.pdv?.nome ?? null,
        abertoPor: c.abertoPor?.nome ?? null,
        abertoEm: c.abertoEm,
        saldoEsperado: new Decimal(c.saldoEsperado).toNumber(),
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
}
