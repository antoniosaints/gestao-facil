import { Request, Response } from "express";
import Decimal from "decimal.js";
import PDFDocument from "pdfkit";
import { endOfDay, endOfMonth, format, startOfDay, startOfMonth } from "date-fns";
import { z } from "zod";

import { getCustomRequest } from "../../helpers/getCustomRequest";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { sendUpdateTable } from "../../hooks/vendas/socket";
import { enqueuePushNotificationByPreference } from "../../services/notifications/notificationPreferenceService";
import { enqueueWhatsAppNotificationByPreference } from "../../services/notifications/whatsappNotificationQueueService";
import {
  buildCaixaPdfFilename,
  CaixaMovementType,
  canDeleteCaixa,
  canUserEnterCaixa,
  getMovementSignedValue,
  shouldReportCaixaMovimento,
} from "../../services/vendas/caixaService";
import {
  abrirCaixaSchema,
  caixaRelatorioQuerySchema,
  criarPdvSchema,
  entrarCaixaSchema,
  fecharCaixaSchema,
  finalizarVendaPdvSchema,
  movimentarCaixaSchema,
} from "../../schemas/caixas";
import { handleError } from "../../utils/handleError";
import { formatCurrency } from "../../utils/formatters";
import { hasPermission } from "../../helpers/userPermission";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";

type PrismaTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function decimalFrom(value: number | string | Decimal | null | undefined) {
  return new Decimal(value || 0);
}

function decimalToNumber(value: Decimal | number | string | null | undefined) {
  return Number(value || 0);
}

function formatCaixa(caixa: any) {
  if (!caixa) return null;

  return {
    ...caixa,
    saldoInicial: decimalToNumber(caixa.saldoInicial),
    saldoEsperado: decimalToNumber(caixa.saldoEsperado),
    saldoContado:
      caixa.saldoContado === null || caixa.saldoContado === undefined
        ? null
        : decimalToNumber(caixa.saldoContado),
    diferenca:
      caixa.diferenca === null || caixa.diferenca === undefined
        ? null
        : decimalToNumber(caixa.diferenca),
  };
}

function resolvePeriodo(query: z.infer<typeof caixaRelatorioQuerySchema>) {
  const inicio = query.inicio
    ? startOfDay(new Date(query.inicio))
    : startOfMonth(new Date());
  const fim = query.fim ? endOfDay(new Date(query.fim)) : endOfMonth(new Date());

  if (
    Number.isNaN(inicio.getTime()) ||
    Number.isNaN(fim.getTime()) ||
    inicio > fim
  ) {
    throw new Error("Informe um periodo valido.");
  }

  return { inicio, fim };
}

function resolveTipoMovimento(
  data: z.infer<typeof movimentarCaixaSchema>
): Extract<CaixaMovementType, "SANGRIA" | "REFORCO"> {
  if (data.tipoMovimento === "SANGRIA" || data.categoria === "SANGRIA") {
    return "SANGRIA";
  }

  if (data.tipoMovimento === "REFORCO" || data.categoria === "REFORCO") {
    return "REFORCO";
  }

  if (data.tipoMovimento === "SAIDA") {
    return "SANGRIA";
  }

  if (data.tipoMovimento === "ENTRADA") {
    return "REFORCO";
  }

  throw new Error("Informe se a movimentacao e sangria ou reforco.");
}

async function getActiveOperator(
  tx: PrismaTransaction,
  contaId: number,
  usuarioId: number
) {
  return tx.caixaOperador.findFirst({
    where: {
      contaId,
      usuarioId,
      ativo: true,
      caixa: {
        status: "ABERTO",
      },
    },
    select: {
      caixaId: true,
    },
  });
}

async function assertUserCanUseCaixa(
  tx: PrismaTransaction,
  contaId: number,
  usuarioId: number,
  caixaId: number
) {
  const activeOperator = await getActiveOperator(tx, contaId, usuarioId);

  if (!canUserEnterCaixa(activeOperator, caixaId)) {
    throw new Error("Usuario ja possui caixa aberto.");
  }

  if (!activeOperator) {
    throw new Error("Usuario nao esta vinculado a este caixa.");
  }

  return activeOperator;
}

async function getCaixaAbertoOrThrow(
  tx: PrismaTransaction,
  contaId: number,
  caixaId: number
) {
  const caixa = await tx.caixaSessao.findFirst({
    where: {
      id: caixaId,
      contaId,
      status: "ABERTO",
    },
  });

  if (!caixa) {
    throw new Error("Caixa aberto nao encontrado.");
  }

  return caixa;
}

async function includeCaixa(tx: PrismaTransaction, contaId: number, caixaId: number) {
  return tx.caixaSessao.findFirstOrThrow({
    where: {
      id: caixaId,
      contaId,
    },
    include: {
      pdv: true,
      abertoPor: {
        select: {
          id: true,
          nome: true,
        },
      },
      fechadoPor: {
        select: {
          id: true,
          nome: true,
        },
      },
      operadores: {
        where: {
          ativo: true,
        },
        include: {
          usuario: {
            select: {
              id: true,
              nome: true,
            },
          },
        },
      },
    },
  });
}

function buildItemName(itemName: string | undefined, entity: { nome: string; nomeVariante?: string | null }) {
  if (itemName) return itemName;
  return entity.nomeVariante && entity.nomeVariante !== "Padrao"
    ? `${entity.nome} / ${entity.nomeVariante}`
    : entity.nome;
}

export async function getContextoCaixa(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;

    const activeOperator = await prisma.caixaOperador.findFirst({
      where: {
        contaId: customData.contaId,
        usuarioId: customData.userId,
        ativo: true,
        caixa: {
          status: "ABERTO",
        },
      },
      include: {
        caixa: {
          include: {
            pdv: true,
            abertoPor: {
              select: {
                id: true,
                nome: true,
              },
            },
            operadores: {
              where: {
                ativo: true,
              },
              include: {
                usuario: {
                  select: {
                    id: true,
                    nome: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const caixasAbertos = await prisma.caixaSessao.findMany({
      where: {
        contaId: customData.contaId,
        status: "ABERTO",
      },
      include: {
        pdv: true,
        abertoPor: {
          select: {
            id: true,
            nome: true,
          },
        },
        operadores: {
          where: {
            ativo: true,
          },
          include: {
            usuario: {
              select: {
                id: true,
                nome: true,
              },
            },
          },
        },
      },
      orderBy: {
        abertoEm: "desc",
      },
    });

    const pdvs = await prisma.pdvPonto.findMany({
      where: {
        contaId: customData.contaId,
        status: "ATIVO",
      },
      orderBy: {
        nome: "asc",
      },
    });

    ResponseHandler(res, "Contexto do caixa encontrado", {
      caixaAtivo: formatCaixa(activeOperator?.caixa),
      caixasAbertos: caixasAbertos.map(formatCaixa),
      pdvs,
    });
  } catch (error) {
    handleError(res, error);
  }
}

export async function abrirCaixa(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const parsed = abrirCaixaSchema.safeParse(req.body);

    if (!parsed.success) {
      return handleError(res, parsed.error);
    }

    const data = parsed.data;
    const valorInicial = decimalFrom(data.valorInicial);

    const caixa = await prisma.$transaction(async (tx) => {
      const activeOperator = await getActiveOperator(
        tx,
        customData.contaId,
        customData.userId
      );

      if (activeOperator) {
        throw new Error("Usuario ja possui caixa aberto.");
      }

      if (data.pdvId) {
        await tx.pdvPonto.findFirstOrThrow({
          where: {
            id: data.pdvId,
            contaId: customData.contaId,
            status: "ATIVO",
          },
        });
      }

      const created = await tx.caixaSessao.create({
        data: {
          codigo: gerarIdUnicoComMetaFinal("CAI"),
          contaId: customData.contaId,
          pdvId: data.pdvId || null,
          abertoPorId: customData.userId,
          saldoInicial: valorInicial,
          saldoEsperado: valorInicial,
          observacaoAbertura: data.observacao,
          operadores: {
            create: {
              contaId: customData.contaId,
              usuarioId: customData.userId,
            },
          },
          movimentos: {
            create: {
              contaId: customData.contaId,
              usuarioId: customData.userId,
              tipo: "ABERTURA",
              valor: valorInicial,
              descricao: data.observacao || "Abertura de caixa",
            },
          },
        },
      });

      return includeCaixa(tx, customData.contaId, created.id);
    });

    await enqueueWhatsAppNotificationByPreference(
      "CAIXA_ABERTO",
      {
        title: "🏷️Caixa aberto.",
        body: `Caixa _*${caixa.codigo}*_ aberto com saldo inicial de *${formatCurrency(caixa.saldoInicial)}*.`,
      },
      customData.contaId
    );

    ResponseHandler(res, "Caixa aberto com sucesso", formatCaixa(caixa));
  } catch (error) {
    handleError(res, error);
  }
}

export async function entrarCaixa(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const parsed = entrarCaixaSchema.safeParse(req.body);

    if (!parsed.success) {
      return handleError(res, parsed.error);
    }

    const caixa = await prisma.$transaction(async (tx) => {
      const target = await getCaixaAbertoOrThrow(
        tx,
        customData.contaId,
        parsed.data.caixaId
      );

      const activeOperator = await getActiveOperator(
        tx,
        customData.contaId,
        customData.userId
      );

      if (!canUserEnterCaixa(activeOperator, target.id)) {
        throw new Error("Usuario ja possui caixa aberto.");
      }

      if (!activeOperator) {
        await tx.caixaOperador.create({
          data: {
            contaId: customData.contaId,
            caixaId: target.id,
            usuarioId: customData.userId,
          },
        });
      }

      return includeCaixa(tx, customData.contaId, target.id);
    });

    ResponseHandler(res, "Usuario vinculado ao caixa", formatCaixa(caixa));
  } catch (error) {
    handleError(res, error);
  }
}

export async function movimentarCaixa(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const parsed = movimentarCaixaSchema.safeParse(req.body);

    if (!parsed.success) {
      return handleError(res, parsed.error);
    }

    const data = parsed.data;
    const tipo = resolveTipoMovimento(data);
    const valor = decimalFrom(data.valor);

    const caixa = await prisma.$transaction(async (tx) => {
      const current = await getCaixaAbertoOrThrow(
        tx,
        customData.contaId,
        data.caixaId
      );
      await assertUserCanUseCaixa(
        tx,
        customData.contaId,
        customData.userId,
        current.id
      );

      const signed = getMovementSignedValue(tipo, valor);

      await tx.caixaMovimento.create({
        data: {
          contaId: customData.contaId,
          caixaId: current.id,
          usuarioId: customData.userId,
          tipo,
          valor,
          descricao:
            data.descricao ||
            (tipo === "SANGRIA" ? "Sangria de caixa" : "Reforco de caixa"),
        },
      });

      await tx.caixaSessao.update({
        where: {
          id: current.id,
        },
        data: {
          saldoEsperado: decimalFrom(current.saldoEsperado).plus(signed),
        },
      });

      return includeCaixa(tx, customData.contaId, current.id);
    });

    ResponseHandler(res, "Movimentacao registrada", formatCaixa(caixa));
  } catch (error) {
    handleError(res, error);
  }
}

export async function fecharCaixa(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const parsed = fecharCaixaSchema.safeParse(req.body);

    if (!parsed.success) {
      return handleError(res, parsed.error);
    }

    const data = parsed.data;
    const valorFechamento = decimalFrom(data.valorFechamento);

    const caixa = await prisma.$transaction(async (tx) => {
      const current = await getCaixaAbertoOrThrow(
        tx,
        customData.contaId,
        data.caixaId
      );
      await assertUserCanUseCaixa(
        tx,
        customData.contaId,
        customData.userId,
        current.id
      );

      const saldoEsperado = decimalFrom(current.saldoEsperado);
      const diferenca = valorFechamento.minus(saldoEsperado);

      await tx.caixaMovimento.create({
        data: {
          contaId: customData.contaId,
          caixaId: current.id,
          usuarioId: customData.userId,
          tipo: "FECHAMENTO",
          valor: valorFechamento,
          descricao: data.descricao || "Fechamento de caixa",
        },
      });

      await tx.caixaOperador.updateMany({
        where: {
          caixaId: current.id,
          ativo: true,
        },
        data: {
          ativo: false,
          saiuEm: new Date(),
        },
      });

      await tx.caixaSessao.update({
        where: {
          id: current.id,
        },
        data: {
          status: "FECHADO",
          fechadoPorId: customData.userId,
          fechadoEm: new Date(),
          saldoContado: valorFechamento,
          diferenca,
          observacaoFechamento: data.descricao,
        },
      });

      return includeCaixa(tx, customData.contaId, current.id);
    });

    await enqueueWhatsAppNotificationByPreference(
      "CAIXA_FECHADO",
      {
        title: "🔒Caixa fechado.",
        body: `Caixa _*${caixa.codigo}*_ fechado com saldo contado de *${formatCurrency(caixa.saldoContado || 0)}*.`,
      },
      customData.contaId
    );

    ResponseHandler(res, "Caixa fechado com sucesso", formatCaixa(caixa));
  } catch (error) {
    handleError(res, error);
  }
}

export async function criarPdv(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const parsed = criarPdvSchema.safeParse(req.body);

    if (!parsed.success) {
      return handleError(res, parsed.error);
    }

    const pdv = await prisma.pdvPonto.create({
      data: {
        contaId: customData.contaId,
        nome: parsed.data.nome,
        localizacao: parsed.data.localizacao,
        descricao: parsed.data.descricao,
      },
    });

    ResponseHandler(res, "PDV criado com sucesso", pdv);
  } catch (error) {
    handleError(res, error);
  }
}

export async function buscarPdv(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const id = req.query.id ? Number(req.query.id) : null;

    if (id) {
      const pdv = await prisma.pdvPonto.findFirstOrThrow({
        where: {
          id,
          contaId: customData.contaId,
        },
      });
      return ResponseHandler(res, "PDV encontrado", pdv);
    }

    const pdvs = await prisma.pdvPonto.findMany({
      where: {
        contaId: customData.contaId,
      },
      orderBy: {
        nome: "asc",
      },
    });

    ResponseHandler(res, "PDVs encontrados", pdvs);
  } catch (error) {
    handleError(res, error);
  }
}

export async function buscarCaixa(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const id = req.query.id ? Number(req.query.id) : null;

    if (id) {
      const caixa = await prisma.caixaSessao.findFirstOrThrow({
        where: {
          id,
          contaId: customData.contaId,
        },
        include: {
          pdv: true,
          abertoPor: {
            select: {
              id: true,
              nome: true,
            },
          },
          fechadoPor: {
            select: {
              id: true,
              nome: true,
            },
          },
          operadores: {
            include: {
              usuario: {
                select: {
                  id: true,
                  nome: true,
                },
              },
            },
          },
          movimentos: {
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      });
      return ResponseHandler(res, "Caixa encontrado", formatCaixa(caixa));
    }

    const caixas = await prisma.caixaSessao.findMany({
      where: {
        contaId: customData.contaId,
      },
      include: {
        pdv: true,
        abertoPor: {
          select: {
            id: true,
            nome: true,
          },
        },
        fechadoPor: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
      orderBy: {
        abertoEm: "desc",
      },
      take: 50,
    });

    ResponseHandler(res, "Caixas encontrados", caixas.map(formatCaixa));
  } catch (error) {
    handleError(res, error);
  }
}

export async function resumoCaixa(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const caixaId = Number(req.query.id);

    if (!caixaId) {
      throw new Error("Informe o caixa.");
    }

    const caixa = await prisma.caixaSessao.findFirstOrThrow({
      where: {
        id: caixaId,
        contaId: customData.contaId,
      },
      include: {
        movimentos: true,
        vendas: {
          include: {
            PagamentoVendas: true,
            ItensVendas: {
              include: {
                produto: true,
              },
            },
          },
        },
      },
    });

    ResponseHandler(res, "Resumo do caixa encontrado", buildCaixaResumo(caixa));
  } catch (error) {
    handleError(res, error);
  }
}

function buildCaixaResumo(caixa: any) {
  const movimentosReportaveis = caixa.movimentos.filter(shouldReportCaixaMovimento);
  const porMetodo = caixa.vendas.reduce((acc: Record<string, number>, venda: any) => {
    const metodo = venda.PagamentoVendas?.metodo || "OUTRO";
    acc[metodo] = (acc[metodo] || 0) + decimalToNumber(venda.valor);
    return acc;
  }, {});

  const movimentos = movimentosReportaveis.reduce(
    (
      acc: {
        totalSangrias: number;
        totalReforcos: number;
        totalVendasMovimentos: number;
      },
      movimento: any
    ) => {
      if (movimento.tipo === "SANGRIA") {
        acc.totalSangrias += decimalToNumber(movimento.valor);
      }
      if (movimento.tipo === "REFORCO") {
        acc.totalReforcos += decimalToNumber(movimento.valor);
      }
      if (movimento.tipo === "VENDA") {
        acc.totalVendasMovimentos += decimalToNumber(movimento.valor);
      }
      return acc;
    },
    { totalSangrias: 0, totalReforcos: 0, totalVendasMovimentos: 0 }
  );

  const produtosMap = new Map<string, { nome: string; quantidade: number; total: number }>();

  caixa.vendas.forEach((venda: any) => {
    venda.ItensVendas.forEach((item: any) => {
      const nome =
        item.itemName ||
        item.produto?.nome ||
        item.servico?.nome ||
        "Item";
      const key = item.produtoId ? `produto:${item.produtoId}` : `item:${nome}`;
      const current = produtosMap.get(key) || { nome, quantidade: 0, total: 0 };
      current.quantidade += Number(item.quantidade || 0);
      current.total += Number(item.quantidade || 0) * decimalToNumber(item.valor);
      produtosMap.set(key, current);
    });
  });

  const produtosMaisVendidos = Array.from(produtosMap.values())
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 10);

  return {
    caixa: formatCaixa({ ...caixa, movimentos: movimentosReportaveis }),
    resumo: {
      totalVendido: caixa.vendas.reduce(
        (acc: number, venda: any) => acc + decimalToNumber(venda.valor),
        0
      ),
      totalVendas: caixa.vendas.length,
      porMetodo,
      ...movimentos,
      saldoInicial: decimalToNumber(caixa.saldoInicial),
      saldoEsperado: decimalToNumber(caixa.saldoEsperado),
      saldoContado:
        caixa.saldoContado === null || caixa.saldoContado === undefined
          ? null
          : decimalToNumber(caixa.saldoContado),
      diferenca:
        caixa.diferenca === null || caixa.diferenca === undefined
          ? null
          : decimalToNumber(caixa.diferenca),
    },
    produtosMaisVendidos,
    movimentos: movimentosReportaveis,
    vendas: caixa.vendas,
  };
}

function formatPdfDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return format(new Date(value), "dd/MM/yyyy HH:mm");
}

function getPaymentMethodLabel(method?: string | null) {
  switch (method) {
    case "DINHEIRO":
      return "Dinheiro";
    case "CARTAO":
      return "Cartao";
    case "PIX":
      return "PIX";
    case "BOLETO":
      return "Boleto";
    default:
      return method || "-";
  }
}

function ensurePdfSpace(doc: PDFKit.PDFDocument, heightNeeded = 40) {
  if (doc.y + heightNeeded > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function drawPdfSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  ensurePdfSpace(doc, 34);
  doc.moveDown(0.7);
  doc.fontSize(13).fillColor("#111827").font("Helvetica-Bold").text(title);
  doc.moveTo(doc.page.margins.left, doc.y + 4)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
    .strokeColor("#e5e7eb")
    .stroke();
  doc.moveDown(0.7);
}

function drawPdfKeyValue(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number
) {
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#6b7280")
    .text(label, x, y, { width });
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#111827")
    .text(value, x, y + 12, { width });
}

function drawPdfTableHeader(
  doc: PDFKit.PDFDocument,
  columns: Array<{ label: string; x: number; width: number; align?: "left" | "right" }>
) {
  ensurePdfSpace(doc, 28);
  const y = doc.y;
  doc.rect(doc.page.margins.left, y - 2, doc.page.width - doc.page.margins.left - doc.page.margins.right, 20)
    .fill("#f3f4f6");
  columns.forEach((column) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("#374151")
      .text(column.label, column.x, y + 4, {
        width: column.width,
        align: column.align || "left",
      });
  });
  doc.y = y + 24;
}

function drawPdfTableRow(
  doc: PDFKit.PDFDocument,
  columns: Array<{ text: string; x: number; width: number; align?: "left" | "right" }>,
  height = 24
) {
  ensurePdfSpace(doc, height + 6);
  const y = doc.y;
  columns.forEach((column) => {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#111827")
      .text(column.text, column.x, y, {
        width: column.width,
        align: column.align || "left",
        ellipsis: true,
      });
  });
  doc.moveTo(doc.page.margins.left, y + height - 5)
    .lineTo(doc.page.width - doc.page.margins.right, y + height - 5)
    .strokeColor("#f3f4f6")
    .stroke();
  doc.y = y + height;
}

export async function gerarCaixaPdf(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const caixaId = Number(req.params.id);

    if (!caixaId) {
      throw new Error("Informe o caixa.");
    }

    const caixa = await prisma.caixaSessao.findFirstOrThrow({
      where: {
        id: caixaId,
        contaId: customData.contaId,
      },
      include: {
        pdv: true,
        abertoPor: {
          select: {
            id: true,
            nome: true,
          },
        },
        fechadoPor: {
          select: {
            id: true,
            nome: true,
          },
        },
        movimentos: {
          orderBy: {
            createdAt: "asc",
          },
        },
        vendas: {
          include: {
            PagamentoVendas: true,
            ItensVendas: {
              include: {
                produto: true,
                servico: true,
              },
            },
          },
        },
      },
    });

    const dados = buildCaixaResumo(caixa);
    const doc = new PDFDocument({ size: "A4", margin: 42 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${buildCaixaPdfFilename(caixa.codigo)}`
    );

    doc.pipe(res);

    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor("#111827")
      .text("Relatorio de Caixa PDV");
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#6b7280")
      .text(`Gerado em ${formatPdfDate(new Date())}`);

    doc.moveDown(1);
    const startY = doc.y;
    const colWidth = 165;
    drawPdfKeyValue(doc, "Caixa", caixa.codigo, 42, startY, colWidth);
    drawPdfKeyValue(doc, "Status", caixa.status, 220, startY, colWidth);
    drawPdfKeyValue(doc, "PDV", caixa.pdv?.nome || "-", 398, startY, 150);
    drawPdfKeyValue(doc, "Aberto por", caixa.abertoPor?.nome || "-", 42, startY + 42, colWidth);
    drawPdfKeyValue(doc, "Abertura", formatPdfDate(caixa.abertoEm), 220, startY + 42, colWidth);
    drawPdfKeyValue(doc, "Fechamento", formatPdfDate(caixa.fechadoEm), 398, startY + 42, 150);
    doc.y = startY + 88;

    drawPdfSectionTitle(doc, "Resumo financeiro");
    const metricY = doc.y;
    drawPdfKeyValue(doc, "Total vendido", formatCurrency(dados.resumo.totalVendido), 42, metricY, colWidth);
    drawPdfKeyValue(doc, "Total de vendas", String(dados.resumo.totalVendas), 220, metricY, colWidth);
    drawPdfKeyValue(doc, "Saldo inicial", formatCurrency(dados.resumo.saldoInicial), 398, metricY, 150);
    drawPdfKeyValue(doc, "Saldo esperado", formatCurrency(dados.resumo.saldoEsperado), 42, metricY + 42, colWidth);
    drawPdfKeyValue(doc, "Saldo contado", dados.resumo.saldoContado === null ? "-" : formatCurrency(dados.resumo.saldoContado || 0), 220, metricY + 42, colWidth);
    drawPdfKeyValue(doc, "Diferenca", formatCurrency(dados.resumo.diferenca || 0), 398, metricY + 42, 150);
    drawPdfKeyValue(doc, "Sangrias", formatCurrency(dados.resumo.totalSangrias), 42, metricY + 84, colWidth);
    drawPdfKeyValue(doc, "Reforcos", formatCurrency(dados.resumo.totalReforcos), 220, metricY + 84, colWidth);
    doc.y = metricY + 126;

    drawPdfSectionTitle(doc, "Totais por metodo de pagamento");
    const metodoColumns = [
      { label: "Metodo", x: 42, width: 260 },
      { label: "Valor", x: 388, width: 120, align: "right" as const },
    ];
    drawPdfTableHeader(doc, metodoColumns);
    const metodos = Object.entries(dados.resumo.porMetodo);
    if (!metodos.length) {
      drawPdfTableRow(doc, [
        { text: "Nenhum pagamento vinculado", x: 42, width: 260 },
        { text: "-", x: 388, width: 120, align: "right" },
      ]);
    } else {
      metodos.forEach(([metodo, valor]) => {
        drawPdfTableRow(doc, [
          { text: getPaymentMethodLabel(metodo), x: 42, width: 260 },
          { text: formatCurrency(Number(valor)), x: 388, width: 120, align: "right" },
        ]);
      });
    }

    drawPdfSectionTitle(doc, "Movimentacoes");
    const movimentoColumns = [
      { label: "Data", x: 42, width: 80 },
      { label: "Tipo", x: 130, width: 70 },
      { label: "Metodo", x: 205, width: 70 },
      { label: "Descricao", x: 282, width: 150 },
      { label: "Valor", x: 438, width: 70, align: "right" as const },
    ];
    drawPdfTableHeader(doc, movimentoColumns);
    if (!dados.movimentos.length) {
      drawPdfTableRow(doc, [
        { text: "Nenhuma movimentacao registrada", x: 42, width: 260 },
        { text: "", x: 130, width: 70 },
        { text: "", x: 205, width: 70 },
        { text: "", x: 282, width: 150 },
        { text: "-", x: 438, width: 70, align: "right" },
      ]);
    } else {
      dados.movimentos.forEach((movimento: any) => {
        drawPdfTableRow(doc, [
          { text: formatPdfDate(movimento.createdAt), x: 42, width: 80 },
          { text: movimento.tipo, x: 130, width: 70 },
          { text: getPaymentMethodLabel(movimento.metodoPagamento), x: 205, width: 70 },
          { text: movimento.descricao || "-", x: 282, width: 150 },
          { text: formatCurrency(decimalToNumber(movimento.valor)), x: 438, width: 70, align: "right" },
        ]);
      });
    }

    drawPdfSectionTitle(doc, "Produtos mais vendidos");
    const produtoColumns = [
      { label: "Produto", x: 42, width: 270 },
      { label: "Qtd", x: 330, width: 55, align: "right" as const },
      { label: "Total", x: 408, width: 100, align: "right" as const },
    ];
    drawPdfTableHeader(doc, produtoColumns);
    if (!dados.produtosMaisVendidos.length) {
      drawPdfTableRow(doc, [
        { text: "Nenhum produto vendido", x: 42, width: 270 },
        { text: "-", x: 330, width: 55, align: "right" },
        { text: "-", x: 408, width: 100, align: "right" },
      ]);
    } else {
      dados.produtosMaisVendidos.forEach((produto: any) => {
        drawPdfTableRow(doc, [
          { text: produto.nome, x: 42, width: 270 },
          { text: String(produto.quantidade), x: 330, width: 55, align: "right" },
          { text: formatCurrency(produto.total), x: 408, width: 100, align: "right" },
        ]);
      });
    }

    doc.end();
  } catch (error) {
    handleError(res, error);
  }
}

export async function deletarCaixa(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const caixaId = Number(req.params.id);

    if (!caixaId) {
      throw new Error("Informe o caixa.");
    }

    const isAdmin = await hasPermission(customData, 4);
    const caixa = await prisma.caixaSessao.findFirstOrThrow({
      where: {
        id: caixaId,
        contaId: customData.contaId,
      },
      include: {
        _count: {
          select: {
            vendas: true,
          },
        },
      },
    });

    if (!canDeleteCaixa({ isAdmin, linkedSalesCount: caixa._count.vendas })) {
      return ResponseHandler(
        res,
        isAdmin
          ? "Nao e possivel apagar caixa com venda vinculada."
          : "Apenas administradores podem apagar caixas.",
        null,
        403
      );
    }

    await prisma.caixaSessao.delete({
      where: {
        id: caixa.id,
      },
    });

    ResponseHandler(res, "Caixa apagado com sucesso", formatCaixa(caixa));
  } catch (error) {
    handleError(res, error);
  }
}

export async function relatorioCaixa(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const parsed = caixaRelatorioQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return handleError(res, parsed.error);
    }

    const { inicio, fim } = resolvePeriodo(parsed.data);
    const caixaId = parsed.data.caixaId ? Number(parsed.data.caixaId) : undefined;
    const usuarioId = parsed.data.usuarioId
      ? Number(parsed.data.usuarioId)
      : undefined;

    const caixas = await prisma.caixaSessao.findMany({
      where: {
        contaId: customData.contaId,
        id: caixaId,
        status: parsed.data.status,
        abertoPorId: usuarioId,
        abertoEm: {
          gte: inicio,
          lte: fim,
        },
      },
      include: {
        pdv: true,
        abertoPor: {
          select: {
            id: true,
            nome: true,
          },
        },
        fechadoPor: {
          select: {
            id: true,
            nome: true,
          },
        },
        movimentos: {
          orderBy: {
            createdAt: "asc",
          },
        },
        vendas: {
          include: {
            PagamentoVendas: true,
            ItensVendas: {
              include: {
                produto: true,
                servico: true,
              },
            },
          },
        },
      },
      orderBy: {
        abertoEm: "desc",
      },
    });

    const detalhados = caixas.map(buildCaixaResumo);
    const resumo = detalhados.reduce(
      (acc, item) => {
        acc.totalVendido += item.resumo.totalVendido;
        acc.totalVendas += item.resumo.totalVendas;
        acc.totalSangrias += item.resumo.totalSangrias;
        acc.totalReforcos += item.resumo.totalReforcos;
        acc.saldoEsperado += item.resumo.saldoEsperado;
        acc.diferenca += item.resumo.diferenca || 0;

        Object.entries(item.resumo.porMetodo).forEach(([metodo, valor]) => {
          acc.porMetodo[metodo] = (acc.porMetodo[metodo] || 0) + Number(valor);
        });

        item.produtosMaisVendidos.forEach((produto) => {
          const current = acc.produtosMap.get(produto.nome) || {
            nome: produto.nome,
            quantidade: 0,
            total: 0,
          };
          current.quantidade += produto.quantidade;
          current.total += produto.total;
          acc.produtosMap.set(produto.nome, current);
        });

        return acc;
      },
      {
        totalVendido: 0,
        totalVendas: 0,
        totalSangrias: 0,
        totalReforcos: 0,
        saldoEsperado: 0,
        diferenca: 0,
        porMetodo: {} as Record<string, number>,
        produtosMap: new Map<string, { nome: string; quantidade: number; total: number }>(),
      }
    );

    ResponseHandler(res, "Relatorio de caixas encontrado", {
      periodo: { inicio, fim },
      resumo: {
        totalVendido: resumo.totalVendido,
        totalVendas: resumo.totalVendas,
        totalSangrias: resumo.totalSangrias,
        totalReforcos: resumo.totalReforcos,
        saldoEsperado: resumo.saldoEsperado,
        diferenca: resumo.diferenca,
        porMetodo: resumo.porMetodo,
        caixasAbertos: caixas.filter((caixa) => caixa.status === "ABERTO").length,
        caixasFechados: caixas.filter((caixa) => caixa.status === "FECHADO").length,
      },
      produtosMaisVendidos: Array.from(resumo.produtosMap.values())
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, 10),
      caixas: detalhados,
    });
  } catch (error) {
    handleError(res, error);
  }
}

export async function finalizarVendaPdv(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const parsed = finalizarVendaPdvSchema.safeParse(req.body);

    if (!parsed.success) {
      return handleError(res, parsed.error);
    }

    const data = parsed.data;
    const desconto = decimalFrom(data.desconto);
    const valorRecebido = decimalFrom(data.valorRecebido);

    const resultado = await prisma.$transaction(async (tx) => {
      const caixa = await getCaixaAbertoOrThrow(
        tx,
        customData.contaId,
        data.caixaId
      );

      await assertUserCanUseCaixa(
        tx,
        customData.contaId,
        customData.userId,
        caixa.id
      );

      let valorBruto = new Decimal(0);
      const itensParaCriar: Array<{
        itemName: string;
        produtoId: number | null;
        servicoId: number | null;
        quantidade: number;
        valor: Decimal;
      }> = [];

      for (const item of data.itens) {
        const valorUnitario = decimalFrom(item.preco);
        valorBruto = valorBruto.plus(valorUnitario.mul(item.quantidade));

        if (item.tipo === "PRODUTO") {
          const produto = await tx.produto.findUniqueOrThrow({
            where: {
              id: item.id,
              contaId: customData.contaId,
            },
          });

          if (produto.saidas === false) {
            throw new Error(
              `Produto ${produto.nome} nao permite saidas, altere isso antes de continuar`
            );
          }

          if (produto.estoque < item.quantidade) {
            throw new Error(
              `Produto ${produto.nome} nao possui estoque suficiente (disponivel: ${produto.estoque})`
            );
          }

          itensParaCriar.push({
            itemName: buildItemName(item.nome, produto),
            produtoId: item.id,
            servicoId: null,
            quantidade: item.quantidade,
            valor: valorUnitario,
          });
        } else {
          const servico = await tx.servicos.findUniqueOrThrow({
            where: {
              id: item.id,
              contaId: customData.contaId,
            },
          });

          itensParaCriar.push({
            itemName: item.nome || servico.nome,
            produtoId: null,
            servicoId: item.id,
            quantidade: item.quantidade,
            valor: valorUnitario,
          });
        }
      }

      if (desconto.greaterThan(valorBruto)) {
        throw new Error("Desconto maior que o valor da venda.");
      }

      const valorTotal = valorBruto.minus(desconto);

      if (data.pagamento === "DINHEIRO" && valorRecebido.lessThan(valorTotal)) {
        throw new Error("Valor recebido insuficiente.");
      }

      const venda = await tx.vendas.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("VEN"),
          valor: valorTotal,
          clienteId: data.clienteId || null,
          vendedorId: customData.userId,
          contaId: customData.contaId,
          caixaId: caixa.id,
          data: data.data ? new Date(data.data) : new Date(),
          status: "FATURADO",
          faturado: true,
          desconto,
          PagamentoVendas: {
            create: {
              valor: valorTotal,
              metodo: data.pagamento,
              status: "EFETIVADO",
              data: data.data ? new Date(data.data) : new Date(),
            },
          },
        },
      });

      for (const item of itensParaCriar) {
        await tx.itensVendas.create({
          data: {
            vendaId: venda.id,
            itemName: item.itemName,
            produtoId: item.produtoId,
            servicoId: item.servicoId,
            quantidade: item.quantidade,
            valor: item.valor,
          },
        });

        if (item.produtoId) {
          await tx.produto.update({
            where: {
              id: item.produtoId,
            },
            data: {
              estoque: {
                decrement: item.quantidade,
              },
            },
          });

          await tx.movimentacoesEstoque.create({
            data: {
              Uid: gerarIdUnicoComMetaFinal("MOV"),
              vendaId: venda.id,
              produtoId: item.produtoId,
              quantidade: item.quantidade,
              status: "CONCLUIDO",
              tipo: "SAIDA",
              clienteFornecedor: data.clienteId,
              contaId: customData.contaId,
              custo: item.valor,
            },
          });
        }
      }

      await tx.caixaMovimento.create({
        data: {
          contaId: customData.contaId,
          caixaId: caixa.id,
          usuarioId: customData.userId,
          vendaId: venda.id,
          tipo: "VENDA",
          metodoPagamento: data.pagamento,
          valor: valorTotal,
          descricao: `Venda ${venda.Uid}`,
        },
      });

      if (data.pagamento === "DINHEIRO") {
        await tx.caixaSessao.update({
          where: {
            id: caixa.id,
          },
          data: {
            saldoEsperado: decimalFrom(caixa.saldoEsperado).plus(valorTotal),
          },
        });
      }

      return tx.vendas.findUniqueOrThrow({
        where: {
          id: venda.id,
          contaId: customData.contaId,
        },
        include: {
          PagamentoVendas: true,
          ItensVendas: {
            include: {
              produto: true,
              servico: true,
            },
          },
          caixa: true,
        },
      });
    });

    await enqueuePushNotificationByPreference(
      "VENDA_CONCLUIDA",
      {
        title: "Opa! Nova venda.",
        body: `Uma nova venda no valor de ${formatCurrency(
          resultado.valor
        )} foi realizada`,
      },
      customData.contaId
    );

    await enqueueWhatsAppNotificationByPreference(
      "NOVA_VENDA",
      {
        title: "🏷️Nova venda.",
        body: `Venda PDV _*${resultado.Uid}*_ no valor de *${formatCurrency(resultado.valor)}*.`,
      },
      customData.contaId
    );

    sendUpdateTable(customData.contaId, { efetivada: true, pdv: true });
    ResponseHandler(res, "Venda PDV finalizada com sucesso", resultado);
  } catch (error) {
    handleError(res, error);
  }
}
