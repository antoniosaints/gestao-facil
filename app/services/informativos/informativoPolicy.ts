export type InformativoVisibilityInput = {
  status: "RASCUNHO" | "PUBLICADO" | "RESOLVIDO" | "ARQUIVADO";
  escopo: "GLOBAL" | "MODULO" | "CONTAS";
  moduloCodigo?: string | null;
  inicioEm?: Date | null;
  fimEm?: Date | null;
  resolvidoEm?: Date | null;
  contaIds?: number[];
};

const RESOLVED_VISIBILITY_MS = 24 * 60 * 60 * 1000;

export function isInformativoVisible(
  item: InformativoVisibilityInput,
  context: { now: Date; contaId: number; moduloCodes: string[] },
) {
  const publishedInWindow = item.status === "PUBLICADO"
    && (!item.inicioEm || item.inicioEm <= context.now)
    && (!item.fimEm || item.fimEm > context.now);
  const recentlyResolved = item.status === "RESOLVIDO"
    && Boolean(item.resolvidoEm)
    && context.now.getTime() - item.resolvidoEm!.getTime() <= RESOLVED_VISIBILITY_MS;

  if (!publishedInWindow && !recentlyResolved) return false;
  if (item.escopo === "GLOBAL") return true;
  if (item.escopo === "MODULO") return Boolean(item.moduloCodigo && context.moduloCodes.includes(item.moduloCodigo));
  return Boolean(item.contaIds?.includes(context.contaId));
}
