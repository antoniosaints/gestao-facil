import type { Prisma } from "../../../generated";

export function fiscalReportFilters(query: Record<string, unknown>): { where: Prisma.NotaFiscalWhereInput; error?: string } {
  const raw = (key: string) => String(query[key] || "").trim();
  const optional = (key: string) => { const value = raw(key); return !value || value === "TODOS" ? undefined : value; };
  const tipo = optional("tipo"), status = optional("status"), ambiente = optional("ambiente");
  if (tipo && !["NFE", "NFCE", "NFSE"].includes(tipo)) return { where: {}, error: "Tipo de nota inválido." };
  if (status && !/^[A-Z_]{3,40}$/.test(status)) return { where: {}, error: "Status fiscal inválido." };
  if (ambiente && !["HOMOLOGACAO", "PRODUCAO"].includes(ambiente)) return { where: {}, error: "Ambiente fiscal inválido." };
  const inicio = optional("inicio"), fim = optional("fim");
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const validCalendarDay = (value: string) => {
    const date = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if ((inicio && dateOnly.test(inicio) && !validCalendarDay(inicio)) || (fim && dateOnly.test(fim) && !validCalendarDay(fim))) return { where: {}, error: "Informe um período válido para o relatório." };
  const from = inicio ? new Date(dateOnly.test(inicio) ? `${inicio}T00:00:00-03:00` : inicio) : null;
  const to = fim ? new Date(dateOnly.test(fim) ? `${fim}T00:00:00-03:00` : fim) : null;
  if (to && fim && dateOnly.test(fim)) to.setUTCDate(to.getUTCDate() + 1);
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from >= to)) return { where: {}, error: "Informe um período válido para o relatório." };
  const search = raw("search").slice(0, 100);
  const number = /^\d+$/.test(search) && Number.isSafeInteger(Number(search)) ? Number(search) : null;
  const where: Prisma.NotaFiscalWhereInput = {
    ...(tipo ? { tipo } : {}), ...(status ? { status } : {}), ...(ambiente ? { ambiente } : {}),
    ...(from || to ? { criadoEm: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(search ? { OR: [
      { numero: { contains: search } }, { rpsNumero: { contains: search } }, { chaveAcesso: { contains: search } },
      { Cliente: { nome: { contains: search } } }, { Cliente: { documento: { contains: search } } },
      { Venda: { Uid: { contains: search } } }, ...(number ? [{ id: number }] : []),
    ] } : {}),
  };
  return { where };
}
