import type { Request, Response, NextFunction } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { prisma } from "../utils/prisma";

/** Garante que os atalhos de teste nunca transmitam documentos em produção. */
export async function requireFiscalHomologacao(req: Request, res: Response, next: NextFunction) {
  const { contaId } = getCustomRequest(req).customData;
  const config = await prisma.notaFiscalConfiguracao.findUnique({ where: { contaId }, select: { ambiente: true } });
  if (config?.ambiente !== "HOMOLOGACAO") {
    return res.status(409).json({ error: { code: "fiscal_homologation_required", message: "Selecione e salve o ambiente Homologação nas configurações fiscais antes de emitir uma nota de teste." } });
  }
  return next();
}
