import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { endOfMonth, format, startOfMonth } from "date-fns";
import Decimal from "decimal.js";
import { Prisma, StatusOrdemServico } from "../../../generated";

const ORDEM_STATUS: StatusOrdemServico[] = [
  "ABERTA",
  "ORCAMENTO",
  "APROVADA",
  "ANDAMENTO",
  "FATURADA",
  "CANCELADA",
];

export function percentualDelta(atual: number, anterior: number) {
  if (!anterior) return atual ? 100 : 0;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

export function totalOrdem(
  ordem: {
    desconto: Prisma.Decimal;
    ItensOrdensServico: Array<{ valor: Prisma.Decimal; quantidade: number }>;
  },
) {
  const subtotal = ordem.ItensOrdensServico.reduce(
    (total, item) => total.plus(new Decimal(item.valor).times(item.quantidade)),
    new Decimal(0),
  );
  return Decimal.max(0, subtotal.minus(new Decimal(ordem.desconto || 0))).toNumber();
}

export const painelOrdensServico = async (req: Request, res: Response): Promise<any> => {
  try {
    const contaId = getCustomRequest(req).customData.contaId;
    const agora = new Date();
    const inicio = req.query.inicio ? new Date(String(req.query.inicio)) : startOfMonth(agora);
    const fim = req.query.fim ? new Date(String(req.query.fim)) : endOfMonth(agora);

    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) {
      return res.status(400).json({ message: "Período inválido para o painel de serviços." });
    }

    const duracao = fim.getTime() - inicio.getTime();
    const fimAnterior = new Date(inicio.getTime() - 1);
    const inicioAnterior = new Date(fimAnterior.getTime() - duracao);
    const select = {
      id: true,
      Uid: true,
      descricao: true,
      status: true,
      data: true,
      desconto: true,
      Cliente: { select: { id: true, nome: true } },
      Operador: { select: { id: true, nome: true } },
      ItensOrdensServico: {
        select: {
          itemName: true,
          tipo: true,
          quantidade: true,
          valor: true,
          servicoId: true,
        },
      },
    } satisfies Prisma.OrdensServicoSelect;

    const [atuais, anteriores, servicosAtivos] = await Promise.all([
      prisma.ordensServico.findMany({
        where: { contaId, data: { gte: inicio, lte: fim } },
        select,
        orderBy: { data: "desc" },
      }),
      prisma.ordensServico.findMany({
        where: { contaId, data: { gte: inicioAnterior, lte: fimAnterior } },
        select,
      }),
      prisma.servicos.count({ where: { contaId, status: true } }),
    ]);

    const agregar = (ordens: typeof atuais) => {
      const validas = ordens.filter((ordem) => ordem.status !== "CANCELADA");
      const valorTotal = validas.reduce((total, ordem) => total + totalOrdem(ordem), 0);
      const faturadas = validas.filter((ordem) => ordem.status === "FATURADA");
      const valorFaturado = faturadas.reduce((total, ordem) => total + totalOrdem(ordem), 0);
      return {
        quantidade: validas.length,
        valorTotal,
        valorFaturado,
        ticketMedio: validas.length ? valorTotal / validas.length : 0,
      };
    };

    const atual = agregar(atuais);
    const anterior = agregar(anteriores);
    const status = new Map<StatusOrdemServico, number>(ORDEM_STATUS.map((item) => [item, 0]));
    const serie = new Map<string, { quantidade: number; valor: number; faturado: number }>();
    const servicos = new Map<string, { quantidade: number; valor: number }>();
    const operadores = new Map<string, { quantidade: number; valor: number }>();
    const clientes = new Set<number>();

    for (const ordem of atuais) {
      status.set(ordem.status, (status.get(ordem.status) || 0) + 1);
      const cancelada = ordem.status === "CANCELADA";
      const valor = cancelada ? 0 : totalOrdem(ordem);
      const data = format(ordem.data, "yyyy-MM-dd");
      const dia = serie.get(data) || { quantidade: 0, valor: 0, faturado: 0 };
      if (!cancelada) {
        dia.quantidade += 1;
        dia.valor += valor;
        clientes.add(ordem.Cliente.id);
        const operador = operadores.get(ordem.Operador.nome) || { quantidade: 0, valor: 0 };
        operador.quantidade += 1;
        operador.valor += valor;
        operadores.set(ordem.Operador.nome, operador);
      }
      if (ordem.status === "FATURADA") dia.faturado += valor;
      serie.set(data, dia);

      if (!cancelada) {
        for (const item of ordem.ItensOrdensServico) {
          if (item.tipo !== "SERVICO") continue;
          const servico = servicos.get(item.itemName) || { quantidade: 0, valor: 0 };
          servico.quantidade += item.quantidade;
          servico.valor += Number(item.valor) * item.quantidade;
          servicos.set(item.itemName, servico);
        }
      }
    }

    const ranking = <T extends { quantidade: number; valor: number }>(mapa: Map<string, T>) =>
      [...mapa.entries()]
        .map(([nome, valores]) => ({ nome, ...valores }))
        .sort((a, b) => b.valor - a.valor || b.quantidade - a.quantidade)
        .slice(0, 5);

    const pendentes = atuais
      .filter((ordem) => ["ABERTA", "ORCAMENTO", "APROVADA", "ANDAMENTO"].includes(ordem.status))
      .sort((a, b) => a.data.getTime() - b.data.getTime())
      .slice(0, 6)
      .map((ordem) => ({
        id: ordem.id,
        uid: ordem.Uid,
        descricao: ordem.descricao,
        cliente: ordem.Cliente.nome,
        operador: ordem.Operador.nome,
        status: ordem.status,
        data: ordem.data,
        valor: totalOrdem(ordem),
      }));

    return ResponseHandler(res, "Painel de serviços encontrado.", {
      periodo: { inicio, fim },
      kpis: {
        valorOrdens: { atual: atual.valorTotal, anterior: anterior.valorTotal, delta: percentualDelta(atual.valorTotal, anterior.valorTotal) },
        faturado: { atual: atual.valorFaturado, anterior: anterior.valorFaturado, delta: percentualDelta(atual.valorFaturado, anterior.valorFaturado) },
        ticketMedio: { atual: atual.ticketMedio, anterior: anterior.ticketMedio, delta: percentualDelta(atual.ticketMedio, anterior.ticketMedio) },
        quantidade: { atual: atual.quantidade, anterior: anterior.quantidade, delta: percentualDelta(atual.quantidade, anterior.quantidade) },
      },
      operacao: {
        abertas: status.get("ABERTA") || 0,
        orcamentos: status.get("ORCAMENTO") || 0,
        aprovadas: status.get("APROVADA") || 0,
        emAndamento: status.get("ANDAMENTO") || 0,
        faturadas: status.get("FATURADA") || 0,
        canceladas: status.get("CANCELADA") || 0,
        clientesAtendidos: clientes.size,
        servicosAtivos,
        taxaFaturamento: atual.quantidade ? ((status.get("FATURADA") || 0) / atual.quantidade) * 100 : 0,
      },
      serie: [...serie.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([data, valores]) => ({ data, ...valores })),
      distribuicaoStatus: ORDEM_STATUS.map((item) => ({ status: item, total: status.get(item) || 0 })),
      topServicos: ranking(servicos),
      topOperadores: ranking(operadores),
      pendentes,
    });
  } catch (err: any) {
    handleError(res, err);
  }
};

export const resumoOrdensServico = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;

    const ordensServico = await prisma.ordensServico.findMany({
      where: { contaId: customData.contaId },
      include: { ItensOrdensServico: true },
    });

    const resumo = {
      total: new Decimal(0),
      faturado: new Decimal(0),
      aberta: new Decimal(0),
      andamento: new Decimal(0),
      quantidade: 0,

      // quantidades por status
      qtdAberta: 0,
      qtdAndamento: 0,
      qtdFaturada: 0,
    };

    ordensServico.forEach((row) => {
      const totalOS = row.ItensOrdensServico.reduce((acc, item) => {
        return acc.plus(new Decimal(item.valor).times(item.quantidade));
      }, new Decimal(0));

      resumo.total = resumo.total.plus(totalOS);
      resumo.quantidade++;

      if (row.status === "ABERTA") {
        resumo.aberta = resumo.aberta.plus(totalOS);
        resumo.qtdAberta++;
      }

      if (row.status === "ANDAMENTO") {
        resumo.andamento = resumo.andamento.plus(totalOS);
        resumo.qtdAndamento++;
      }

      if (row.status === "FATURADA") {
        resumo.faturado = resumo.faturado.plus(totalOS);
        resumo.qtdFaturada++;
      }
    });

    return ResponseHandler(res, "Resumo encontrado", resumo);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};

export const getEventosCalendario = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const { inicio, fim } = req.query;

    const where: Prisma.OrdensServicoWhereInput = {
      contaId: customData.contaId,
    };

    if (inicio && fim) {
      where.data = {
        gte: new Date(inicio as string),
        lte: new Date(fim as string),
      };
    } else {
      where.data = {
        gte: startOfMonth(new Date()),
        lte: endOfMonth(new Date()),
      };
    }
    const eventos = await prisma.ordensServico.findMany({
      where,
    });

    return ResponseHandler(res, "Eventos encontrados", eventos);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
