import { Request, Response } from "express";

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

type SalesFilterKind = keyof typeof SALES_FILTER_OPTIONS;

function resolveKind(value: unknown): SalesFilterKind | null {
  if (value === "status" || value === "desconto") {
    return value;
  }

  return null;
}

export async function select2FiltrosVendas(req: Request, res: Response): Promise<any> {
  const kind = resolveKind(req.query.kind);

  if (!kind) {
    return res.json({ results: [] });
  }

  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const id = typeof req.query.id === "string" ? req.query.id : null;
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
