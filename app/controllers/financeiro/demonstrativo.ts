import { Request, Response } from "express";
import Decimal from "decimal.js";
import PDFDocument from "pdfkit";
import { endOfDay, format as formatDate, startOfDay } from "date-fns";

import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { parseDataFiltro } from "../../helpers/periodo";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { resolveRenderableImageSource } from "../../services/uploads/fileStorageService";
import {
  montarDemonstrativo,
  type DemonstrativoPayload,
  type FiltrosDemonstrativo,
} from "../../services/financeiro/demonstrativoService";
import { normalizeRegime } from "../../services/financeiro/demonstrativoPolicy";

function parseId(valor: unknown) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function parseFiltros(req: Request): FiltrosDemonstrativo | null {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) return null;

  const dataInicio = startOfDay(parseDataFiltro(String(inicio)));
  const dataFim = endOfDay(parseDataFiltro(String(fim)));

  if (Number.isNaN(dataInicio.getTime()) || Number.isNaN(dataFim.getTime())) return null;
  if (dataFim < dataInicio) return null;

  return {
    inicio: dataInicio,
    fim: dataFim,
    regime: normalizeRegime(req.query.regime as string),
    contaFinanceiraId: parseId(req.query.contaFinanceiraId),
    categoriaId: parseId(req.query.categoriaId),
    clienteId: parseId(req.query.clienteId),
    mesesHistorico: parseId(req.query.mesesHistorico),
  };
}

const PERIODO_INVALIDO = 'Informe um período válido nos parâmetros "inicio" e "fim".';

export const getDemonstrativoFinanceiro = async (req: Request, res: Response): Promise<any> => {
  try {
    const filtros = parseFiltros(req);
    if (!filtros) return res.status(400).json({ message: PERIODO_INVALIDO });

    const contaId = getCustomRequest(req).customData.contaId;
    const demonstrativo = await montarDemonstrativo(contaId, filtros);

    return ResponseHandler(res, "Demonstrativo gerado com sucesso.", demonstrativo);
  } catch (error) {
    handleError(res, error);
  }
};

function toNumero(valor: Decimal) {
  return valor.toFixed(2).replace(".", ",");
}

function escaparCsv(valor: string) {
  return `"${String(valor).replace(/"/g, '""')}"`;
}

/// Percentuais chegam com casas extras de propósito; o arredondamento acontece
/// aqui, uma única vez, na formatação de saída.
function toPercentual(valor: number | null) {
  return valor === null ? "" : valor.toFixed(2).replace(".", ",");
}

function montarLinhasCsv(demonstrativo: DemonstrativoPayload) {
  const linhas: string[] = [];
  const cabecalho = ["Grupo", "Categoria", "Valor", "AV %", "Período anterior", "AH %"];
  linhas.push(cabecalho.map(escaparCsv).join(";"));

  const secoes: Array<[string, DemonstrativoPayload["grupos"]["receitas"]]> = [
    ["RECEITAS", demonstrativo.grupos.receitas],
    ["DESPESAS", demonstrativo.grupos.despesas],
  ];

  for (const [titulo, grupos] of secoes) {
    for (const grupo of grupos) {
      linhas.push(
        [
          titulo,
          grupo.nome,
          toNumero(grupo.valor),
          toPercentual(grupo.participacao),
          toNumero(grupo.anterior),
          toPercentual(grupo.variacao),
        ]
          .map(escaparCsv)
          .join(";"),
      );

      // Só detalha quando a raiz tem mais de uma linha filha; senão repetiria o grupo.
      if (grupo.subcategorias.length > 1) {
        for (const sub of grupo.subcategorias) {
          linhas.push(
            [
              `${titulo} > ${grupo.nome}`,
              sub.nome,
              toNumero(sub.valor),
              toPercentual(sub.participacao),
              toNumero(sub.anterior),
              toPercentual(sub.variacao),
            ]
              .map(escaparCsv)
              .join(";"),
          );
        }
      }
    }
  }

  const { resumo } = demonstrativo;
  linhas.push("");
  linhas.push(["RESULTADO", "Total de receitas", toNumero(resumo.receitas), "", toNumero(resumo.anterior.receitas), ""].map(escaparCsv).join(";"));
  linhas.push(["RESULTADO", "Total de despesas", toNumero(resumo.despesas), "", toNumero(resumo.anterior.despesas), ""].map(escaparCsv).join(";"));
  linhas.push(["RESULTADO", "Resultado do período", toNumero(resumo.resultado), toPercentual(resumo.margem), toNumero(resumo.anterior.resultado), ""].map(escaparCsv).join(";"));

  return linhas.join("\n");
}

export const getDemonstrativoCsv = async (req: Request, res: Response): Promise<any> => {
  try {
    const filtros = parseFiltros(req);
    if (!filtros) return res.status(400).json({ message: PERIODO_INVALIDO });

    const contaId = getCustomRequest(req).customData.contaId;
    const demonstrativo = await montarDemonstrativo(contaId, filtros);

    const inicio = formatDate(filtros.inicio, "yyyy-MM-dd");
    const fim = formatDate(filtros.fim, "yyyy-MM-dd");

    res.setHeader("Content-Disposition", `attachment; filename="demonstrativo_${inicio}_a_${fim}.csv"`);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    // BOM para o Excel pt-BR abrir os acentos corretamente.
    return res.send(`﻿${montarLinhasCsv(demonstrativo)}`);
  } catch (error) {
    handleError(res, error);
  }
};

function formatarMoeda(valor: Decimal) {
  return valor
    .toFixed(2)
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d),)/g, ".");
}

export const getDemonstrativoPdf = async (req: Request, res: Response): Promise<any> => {
  try {
    const filtros = parseFiltros(req);
    if (!filtros) return res.status(400).json({ message: PERIODO_INVALIDO });

    const contaId = getCustomRequest(req).customData.contaId;
    const [conta, demonstrativo] = await Promise.all([
      prisma.contas.findFirst({ where: { id: contaId } }),
      montarDemonstrativo(contaId, filtros),
    ]);

    const inicio = formatDate(filtros.inicio, "yyyy-MM-dd");
    const fim = formatDate(filtros.fim, "yyyy-MM-dd");

    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="demonstrativo_${inicio}_a_${fim}.pdf"`);
    doc.pipe(res);

    doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
    doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

    const margemEsquerda = 40;
    const larguraUtil = doc.page.width - margemEsquerda * 2;
    const colunaValor = margemEsquerda + larguraUtil - 210;
    const colunaAv = margemEsquerda + larguraUtil - 130;
    const colunaAnterior = margemEsquerda + larguraUtil - 90;
    const colunaAh = margemEsquerda + larguraUtil - 40;

    doc.image(await resolveRenderableImageSource(conta?.profile), margemEsquerda, 36, { fit: [50, 50] });
    doc
      .font("Roboto-Bold")
      .fontSize(16)
      .fillColor("#111827")
      .text(conta?.nomeFantasia || conta?.nome || "Conta", 100, 40, { width: 340 });
    doc
      .font("Roboto")
      .fontSize(9)
      .fillColor("#6B7280")
      .text(conta?.documento || "Documento não informado", 100, 60, { width: 340 });

    doc.font("Roboto-Bold").fontSize(14).fillColor("#111827").text("Demonstrativo financeiro", margemEsquerda, 100);
    doc
      .font("Roboto")
      .fontSize(9)
      .fillColor("#6B7280")
      .text(
        `Regime de ${filtros.regime === "CAIXA" ? "caixa" : "competência"} • ${formatDate(filtros.inicio, "dd/MM/yyyy")} a ${formatDate(filtros.fim, "dd/MM/yyyy")}`,
        margemEsquerda,
        120,
      )
      .text(
        `Comparado com ${formatDate(demonstrativo.periodo.anterior.inicio, "dd/MM/yyyy")} a ${formatDate(demonstrativo.periodo.anterior.fim, "dd/MM/yyyy")} • emitido em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`,
        margemEsquerda,
        133,
      );

    doc.y = 158;

    function quebrarPagina(espaco: number) {
      if (doc.y + espaco > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        doc.y = 50;
      }
    }

    function linhaTabela(
      rotulo: string,
      valor: Decimal,
      participacao: number,
      anterior: Decimal,
      variacao: number | null,
      opcoes: { negrito?: boolean; recuo?: number } = {},
    ) {
      quebrarPagina(18);
      const y = doc.y;
      doc
        .font(opcoes.negrito ? "Roboto-Bold" : "Roboto")
        .fontSize(9)
        .fillColor(opcoes.negrito ? "#111827" : "#374151");

      doc.text(rotulo, margemEsquerda + (opcoes.recuo || 0), y, { width: colunaValor - margemEsquerda - 10, ellipsis: true });
      doc.text(formatarMoeda(valor), colunaValor, y, { width: 74, align: "right" });
      doc.text(`${participacao.toFixed(1)}%`, colunaAv, y, { width: 36, align: "right" });
      doc.text(formatarMoeda(anterior), colunaAnterior, y, { width: 46, align: "right" });
      doc.text(variacao === null ? "-" : `${variacao.toFixed(1)}%`, colunaAh, y, { width: 40, align: "right" });

      doc.y = y + 14;
    }

    function cabecalhoSecao(titulo: string) {
      quebrarPagina(30);
      doc.moveDown(0.4);
      const y = doc.y;
      doc.font("Roboto-Bold").fontSize(10).fillColor("#111827").text(titulo, margemEsquerda, y);
      doc.font("Roboto-Bold").fontSize(8).fillColor("#6B7280");
      doc.text("Valor", colunaValor, y + 1, { width: 74, align: "right" });
      doc.text("AV%", colunaAv, y + 1, { width: 36, align: "right" });
      doc.text("Anterior", colunaAnterior, y + 1, { width: 46, align: "right" });
      doc.text("AH%", colunaAh, y + 1, { width: 40, align: "right" });
      doc.y = y + 16;
      doc
        .moveTo(margemEsquerda, doc.y)
        .lineTo(margemEsquerda + larguraUtil, doc.y)
        .strokeColor("#E5E7EB")
        .stroke();
      doc.y += 6;
    }

    for (const [titulo, grupos] of [
      ["Receitas", demonstrativo.grupos.receitas],
      ["Despesas", demonstrativo.grupos.despesas],
    ] as const) {
      cabecalhoSecao(titulo);

      if (!grupos.length) {
        doc.font("Roboto").fontSize(9).fillColor("#9CA3AF").text("Nenhum lançamento no período.", margemEsquerda, doc.y);
        doc.y += 16;
        continue;
      }

      for (const grupo of grupos) {
        linhaTabela(grupo.nome, grupo.valor, grupo.participacao, grupo.anterior, grupo.variacao, { negrito: true });
        if (grupo.subcategorias.length > 1) {
          for (const sub of grupo.subcategorias) {
            linhaTabela(sub.nome, sub.valor, sub.participacao, sub.anterior, sub.variacao, { recuo: 14 });
          }
        }
      }
    }

    const { resumo } = demonstrativo;
    cabecalhoSecao("Resultado");
    linhaTabela("Total de receitas", resumo.receitas, 100, resumo.anterior.receitas, resumo.variacao.receitas, { negrito: true });
    linhaTabela(
      "Total de despesas",
      resumo.despesas,
      resumo.receitas.isZero() ? 0 : resumo.despesas.dividedBy(resumo.receitas).times(100).toNumber(),
      resumo.anterior.despesas,
      resumo.variacao.despesas,
      { negrito: true },
    );
    linhaTabela("Resultado do período", resumo.resultado, resumo.margem, resumo.anterior.resultado, resumo.variacao.resultado, {
      negrito: true,
    });

    doc.end();
  } catch (error) {
    handleError(res, error);
  }
};
