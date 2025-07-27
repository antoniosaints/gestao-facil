import { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { prisma } from "../../utils/prisma";
import Decimal from "decimal.js";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { endOfMonth, startOfMonth, subMonths } from "date-fns";

export const getDRELancamentos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;

  if (!inicio || !fim) {
    return res
      .status(400)
      .json({ erro: 'Informe os parâmetros "inicio" e "fim".' });
  }

  const filtro = {
    dataLancamento: {
      gte: new Date(inicio as string),
      lte: new Date(fim as string),
    },
  };

  const contaId = getCustomRequest(req).customData.contaId;

  // Buscar lançamentos filtrados diretamente
  const lancamentos = await prisma.lancamentoFinanceiro.findMany({
    where: {
      ...filtro,
      contaId,
    },
    select: {
      valorTotal: true,
      desconto: true,
      tipo: true,
      categoria: {
        select: {
          nome: true,
        },
      },
    },
  });

  const dre = {
    receitas: new Map<string, Decimal>(),
    despesas: new Map<string, Decimal>(),
    totalReceitas: new Decimal(0),
    totalDespesas: new Decimal(0),
    lucro: new Decimal(0),
  };

  for (const l of lancamentos) {
    const nomeCategoria = l.categoria?.nome ?? "Sem categoria";
    const valor = new Decimal(l.valorTotal);

    if (l.tipo === "RECEITA") {
      const atual = dre.receitas.get(nomeCategoria) ?? new Decimal(0);
      dre.receitas.set(nomeCategoria, atual.plus(valor));
      dre.totalReceitas = dre.totalReceitas.plus(valor);
    } else if (l.tipo === "DESPESA") {
      const atual = dre.despesas.get(nomeCategoria) ?? new Decimal(0);
      dre.despesas.set(nomeCategoria, atual.plus(valor));
      dre.totalDespesas = dre.totalDespesas.plus(valor);
    }
  }

  dre.lucro = dre.totalReceitas.minus(dre.totalDespesas);

  res.json({
    receitas: Array.from(dre.receitas.entries()).map(([categoria, valor]) => ({
      categoria,
      valor,
    })),
    despesas: Array.from(dre.despesas.entries()).map(([categoria, valor]) => ({
      categoria,
      valor,
    })),
    totalReceitas: dre.totalReceitas,
    totalDespesas: dre.totalDespesas,
    lucro: dre.lucro,
  });
};
export const getDRELancamentosPDF = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;

  if (!inicio || !fim) {
    return res
      .status(400)
      .json({ erro: 'Informe os parâmetros "inicio" e "fim".' });
  }

  const filtro = {
    dataLancamento: {
      gte: new Date(inicio as string),
      lte: new Date(fim as string),
    },
  };

  const categorias = await prisma.categoriaFinanceiro.findMany({
    where: {
      contaId: customData.contaId,
    },
    include: {
      lancamentos: {
        where: filtro,
        select: {
          valorTotal: true,
          tipo: true,
        },
      },
    },
  });

  const dre = {
    receitas: [] as { categoria: string; valor: Decimal }[],
    despesas: [] as { categoria: string; valor: Decimal }[],
    totalReceitas: new Decimal(0),
    totalDespesas: new Decimal(0),
    lucro: new Decimal(0),
  };

  for (const cat of categorias) {
    let totalReceita = new Decimal(0);
    let totalDespesa = new Decimal(0);

    for (const l of cat.lancamentos) {
      if (l.tipo === "RECEITA") {
        totalReceita = totalReceita.plus(l.valorTotal);
      } else if (l.tipo === "DESPESA") {
        totalDespesa = totalDespesa.plus(l.valorTotal);
      }
    }

    if (!totalReceita.isZero()) {
      dre.receitas.push({ categoria: cat.nome, valor: totalReceita });
      dre.totalReceitas = dre.totalReceitas.plus(totalReceita);
    }

    if (!totalDespesa.isZero()) {
      dre.despesas.push({ categoria: cat.nome, valor: totalDespesa });
      dre.totalDespesas = dre.totalDespesas.plus(totalDespesa);
    }
  }

  dre.lucro = dre.totalReceitas.minus(dre.totalDespesas);

  // Gerar PDF
  const doc = new PDFDocument({ margin: 50, size: "A4", layout: "portrait" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="dre_${inicio}_a_${fim}.pdf"`
  );

  doc.pipe(res);

  doc
    .fontSize(18)
    .text("DRE - Demonstrativo de Resultado do Exercício", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Período: ${inicio} a ${fim}`);
  doc.moveDown();

  // Tabela Receitas
  doc.fontSize(14).text("Receitas", { underline: true });
  doc.fontSize(12).text("Categoria".padEnd(30) + "Valor".padEnd(15) + "%");
  doc.moveDown(0.5);
  dre.receitas.forEach((r) => {
    const perc = r.valor
      .div(dre.totalReceitas)
      .times(100)
      .toFixed(1)
      .padStart(5);
    doc
      .font("Helvetica")
      .text(
        `${r.categoria.padEnd(30)} R$ ${r.valor.toFixed(2).padEnd(12)} ${perc}%`
      );
  });
  doc.moveDown();
  doc
    .font("Helvetica")
    .text(
      `Total de Receitas:`.padEnd(30) + `R$ ${dre.totalReceitas.toFixed(2)}`
    );
  doc.moveDown(1);

  // Tabela Despesas
  doc.fontSize(14).text("Despesas", { underline: true });
  doc.fontSize(12).text("Categoria".padEnd(30) + "Valor".padEnd(15) + "%");
  doc.moveDown(0.5);
  dre.despesas.forEach((d) => {
    const perc = d.valor
      .div(dre.totalDespesas)
      .times(100)
      .toFixed(1)
      .padStart(5);
    doc
      .font("Helvetica")
      .text(
        `${d.categoria.padEnd(30)} R$ ${d.valor.toFixed(2).padEnd(12)} ${perc}%`
      );
  });
  doc.moveDown();
  doc
    .font("Helvetica")
    .text(
      `Total de Despesas:`.padEnd(30) + `R$ ${dre.totalDespesas.toFixed(2)}`
    );
  doc.moveDown(1);

  // Lucro
  doc
    .fontSize(14)
    .font("Helvetica")
    .text(`Lucro Operacional:`.padEnd(30) + `R$ ${dre.lucro.toFixed(2)}`, {
      align: "right",
    });

  doc.end();
};
export const getParcelasAtrasadas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const hoje = new Date();
  const customData = getCustomRequest(req).customData;
  const parcelas = await prisma.parcela.findMany({
    where: {
      pago: false,
      vencimento: { lt: hoje },
      lancamento: {
        contaId: customData.contaId,
      },
    },
    include: {
      lancamento: {
        select: {
          descricao: true,
          cliente: { select: { nome: true } },
          categoria: { select: { nome: true } },
        },
      },
    },
  });

  res.json(
    parcelas.map((p) => ({
      id: p.id,
      numero: p.numero,
      valor: p.valor,
      vencimento: p.vencimento,
      cliente: p.lancamento.cliente?.nome || "Não informado",
      categoria: p.lancamento.categoria.nome,
      descricao: p.lancamento.descricao,
    }))
  );
};
export const getResumoPorCliente = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;
  const dataFilter =
    inicio && fim
      ? {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        }
      : {};

  const clientes = await prisma.clientesFornecedores.findMany({
    where: { contaId: customData.contaId },
    include: {
      LancamentoFinanceiro: {
        where: dataFilter,
        select: {
          valorTotal: true,
          tipo: true,
        },
      },
    },
  });

  const resultado = clientes.map((cliente) => {
    const receitas = cliente.LancamentoFinanceiro.filter(
      (l) => l.tipo === "RECEITA"
    );
    const despesas = cliente.LancamentoFinanceiro.filter(
      (l) => l.tipo === "DESPESA"
    );

    const totalReceitas = receitas.reduce(
      (s, l) => s.plus(l.valorTotal),
      new Decimal(0)
    );
    const totalDespesas = despesas.reduce(
      (s, l) => s.plus(l.valorTotal),
      new Decimal(0)
    );

    return {
      cliente: cliente.nome,
      receitas: totalReceitas,
      despesas: totalDespesas,
      saldo: totalReceitas.minus(totalDespesas),
    };
  });

  res.json(resultado);
};
export const getMediaMensalLancamentos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const meses = Array.from({ length: 6 })
    .map((_, i) => {
      const mes = subMonths(new Date(), i);
      return {
        inicio: startOfMonth(mes),
        fim: endOfMonth(mes),
        label: mes.toLocaleDateString("pt-BR", {
          month: "short",
          year: "numeric",
        }),
      };
    })
    .reverse();

  const resultado = [];

  for (const mes of meses) {
    const receitas = await prisma.lancamentoFinanceiro.aggregate({
      _sum: { valorTotal: true },
      where: {
        contaId: customData.contaId,
        tipo: "RECEITA",
        dataLancamento: {
          gte: mes.inicio,
          lte: mes.fim,
        },
      },
    });

    const despesas = await prisma.lancamentoFinanceiro.aggregate({
      _sum: { valorTotal: true },
      where: {
        contaId: customData.contaId,
        tipo: "DESPESA",
        dataLancamento: {
          gte: mes.inicio,
          lte: mes.fim,
        },
      },
    });

    resultado.push({
      mes: mes.label,
      receitas: receitas._sum.valorTotal || new Decimal(0),
      despesas: despesas._sum.valorTotal || new Decimal(0),
      saldo: new Decimal(receitas._sum.valorTotal || 0).minus(
        despesas._sum.valorTotal || 0
      ),
    });
  }

  res.json(resultado);
};
export const getLancamentosPorConta = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const contas = await prisma.contasFinanceiro.findMany({
    where: { contaId: customData.contaId },
    include: {
      lancamentos: true,
    },
  });

  const resultado = contas.map((conta) => {
    const receitas = conta.lancamentos.filter((l) => l.tipo === "RECEITA");
    const despesas = conta.lancamentos.filter((l) => l.tipo === "DESPESA");

    const totalReceitas = receitas.reduce(
      (s, l) => s.plus(l.valorTotal),
      new Decimal(0)
    );
    const totalDespesas = despesas.reduce(
      (s, l) => s.plus(l.valorTotal),
      new Decimal(0)
    );

    return {
      conta: conta.nome,
      saldoInicial: conta.saldoInicial,
      receitas: totalReceitas,
      despesas: totalDespesas,
      saldoAtual: conta.saldoInicial.plus(totalReceitas).minus(totalDespesas),
    };
  });

  res.json(resultado);
};
export const getLancamentosPorStatus = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;
  const dataFilter =
    inicio && fim
      ? {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        }
      : {};

  const status = await prisma.lancamentoFinanceiro.groupBy({
    by: ["status"],
    where: {contaId: customData.contaId, ...dataFilter},
    _count: { _all: true },
    _sum: { valorTotal: true },
  });

  res.json(status);
};
export const getLancamentosPorPagamento = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;
  const dataFilter =
    inicio && fim
      ? {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        }
      : {};

  const formas = await prisma.lancamentoFinanceiro.groupBy({
    by: ["formaPagamento"],
    where: {contaId: customData.contaId, ...dataFilter},
    _sum: { valorTotal: true },
  });

  res.json(formas);
};
export const getLancamentosPorCategoria = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;
  const dataFilter =
    inicio && fim
      ? {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        }
      : {};

  const categorias = await prisma.categoriaFinanceiro.findMany({
    where: { contaId: customData.contaId },
    include: {
      lancamentos: {
        where: dataFilter,
        select: {
          valorTotal: true,
          tipo: true,
        },
      },
    },
  });

  const resultado = categorias.map((cat) => {
    const receitas = cat.lancamentos.filter((l) => l.tipo === "RECEITA");
    const despesas = cat.lancamentos.filter((l) => l.tipo === "DESPESA");

    const totalReceita = receitas.reduce(
      (s, l) => s.plus(l.valorTotal),
      new Decimal(0)
    );
    const totalDespesa = despesas.reduce(
      (s, l) => s.plus(l.valorTotal),
      new Decimal(0)
    );

    return {
      categoria: cat.nome,
      totalReceita,
      totalDespesa,
      saldo: totalReceita.minus(totalDespesa),
    };
  });

  res.json(resultado);
};
export const getLancamentosTotaisGerais = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;
  const where =
    inicio && fim
      ? {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        }
      : {};

  const receitas = await prisma.lancamentoFinanceiro.aggregate({
    _sum: { valorTotal: true },
    where: { tipo: "RECEITA", contaId: customData.contaId, ...where },
  });

  const despesas = await prisma.lancamentoFinanceiro.aggregate({
    _sum: { valorTotal: true },
    where: { tipo: "DESPESA", contaId: customData.contaId, ...where },
  });

  res.json({
    receitas: receitas._sum.valorTotal || new Decimal(0),
    despesas: despesas._sum.valorTotal || new Decimal(0),
    saldo: new Decimal(receitas._sum.valorTotal || 0).minus(
      despesas._sum.valorTotal || 0
    ),
  });
};
