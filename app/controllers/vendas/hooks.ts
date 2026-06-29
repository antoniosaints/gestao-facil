import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";

const SALES_FILTER_OPTIONS = {
  status: [
    { id: "ORCAMENTO", label: "Orçamento" },
    { id: "FATURADO", label: "Faturado" },
    { id: "ANDAMENTO", label: "Em andamento" },
    { id: "FINALIZADO", label: "Finalizado" },
    { id: "PENDENTE", label: "Pendente" },
    { id: "CANCELADO", label: "Cancelado" },
  ],
  desconto: [
    { id: "COM_DESCONTO", label: "Com desconto" },
    { id: "SEM_DESCONTO", label: "Sem desconto" },
  ],
} as const;

type StaticSalesFilterKind = keyof typeof SALES_FILTER_OPTIONS;
type SalesFilterKind = StaticSalesFilterKind | "caixa";

function resolveKind(value: unknown): SalesFilterKind | null {
  if (value === "status" || value === "desconto" || value === "caixa") {
    return value;
  }

  return null;
}

function formatCaixaSelectOption(caixa: {
  id: number;
  codigo: string;
  status: string;
  abertoEm: Date;
  abertoPor?: { nome: string } | null;
}) {
  const abertoEm = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(caixa.abertoEm);

  const operador = caixa.abertoPor?.nome ? ` - ${caixa.abertoPor.nome}` : "";
  return {
    id: caixa.id,
    label: `${caixa.codigo} - ${caixa.status} - ${abertoEm}${operador}`,
  };
}

export async function select2FiltrosVendas(req: Request, res: Response): Promise<any> {
  const kind = resolveKind(req.query.kind);

  if (!kind) {
    return res.json({ results: [] });
  }

  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const id = typeof req.query.id === "string" ? req.query.id : null;

  if (kind === "caixa") {
    const customData = getCustomRequest(req).customData;
    const caixaId = id ? Number(id) : null;
    const statusSearch = ["ABERTO", "FECHADO"].includes(search.toUpperCase())
      ? search.toUpperCase()
      : null;
    const caixas = await prisma.caixaSessao.findMany({
      where: {
        contaId: customData.contaId,
        ...(caixaId && Number.isInteger(caixaId)
          ? { id: caixaId }
          : search
            ? {
                OR: [
                  { codigo: { contains: search } },
                  ...(statusSearch ? [{ status: statusSearch as any }] : []),
                  { abertoPor: { nome: { contains: search } } },
                ],
              }
            : {}),
      },
      select: {
        id: true,
        codigo: true,
        status: true,
        abertoEm: true,
        abertoPor: {
          select: {
            nome: true,
          },
        },
      },
      orderBy: {
        abertoEm: "desc",
      },
      take: 20,
    });

    return res.json({ results: caixas.map(formatCaixaSelectOption) });
  }

  const options = SALES_FILTER_OPTIONS[kind];

  if (id) {
    const match = options.find((item) => item.id === id);
    return res.json({ results: match ? [match] : [] });
  }

  const results = search
    ? options.filter((item) => item.label.toLowerCase().includes(search))
    : options;

  return res.json({ results });
}
