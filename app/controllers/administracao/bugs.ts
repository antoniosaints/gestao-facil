import { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { assertSuperAdmin } from "./assinantes";

async function requireSuperAdmin(req: Request, res: Response) {
  const customData = getCustomRequest(req).customData;
  if (!(await assertSuperAdmin(customData.userId))) {
    res.status(403).json({ message: "Usuário sem permissão para gerenciar relatos de bug." });
    return null;
  }
  return customData;
}

const adminInclude = {
  Usuario: { select: { id: true, nome: true, email: true } },
  Conta: { select: { id: true, nome: true } },
  ResolvidoPor: { select: { id: true, nome: true } },
} as const;

const STATUS_VALIDOS = ["ABERTO", "EM_ANALISE", "RESOLVIDO", "DESCARTADO"] as const;

// Allowlist de ordenação: sortBy vem da query e vai direto para o orderBy.
const SORT_FIELDS_BUG = new Set(["id", "createdAt", "status", "severidade"]);

const atualizarSchema = z.object({
  status: z.enum(STATUS_VALIDOS),
  respostaAdmin: z.string().trim().max(4000).optional().nullable(),
});

export async function listRelatosBugAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await requireSuperAdmin(req, res))) return;

    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const pageSize = Number(req.query.pageSize) > 0 ? Number(req.query.pageSize) : 10;
    const search = String(req.query.search || "").trim();
    const statusFiltro = String(req.query.status || "TODOS").toUpperCase();

    const where: any = {};
    if (STATUS_VALIDOS.includes(statusFiltro as (typeof STATUS_VALIDOS)[number])) {
      where.status = statusFiltro;
    }
    if (search) {
      where.OR = [
        { titulo: { contains: search } },
        { descricao: { contains: search } },
      ];
    }

    const requestedSortBy = String(req.query.sortBy || "");
    const sortBy = SORT_FIELDS_BUG.has(requestedSortBy) ? requestedSortBy : "createdAt";
    const order = req.query.order === "asc" ? "asc" : "desc";

    const [total, registros] = await Promise.all([
      prisma.relatoBug.count({ where }),
      prisma.relatoBug.findMany({
        where,
        include: adminInclude,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: order },
      }),
    ]);

    return res.json({
      data: registros,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    });
  } catch (error) {
    handleError(res, error);
  }
}

export async function updateRelatoBugAdmin(req: Request, res: Response): Promise<any> {
  try {
    const customData = await requireSuperAdmin(req, res);
    if (!customData) return;

    const id = Number(req.params.id);
    if (!id || isNaN(id)) throw new Error("Id do relato inválido.");

    const parsed = atualizarSchema.parse(req.body);
    const resolvido = parsed.status === "RESOLVIDO" || parsed.status === "DESCARTADO";

    const item = await prisma.relatoBug.update({
      where: { id },
      data: {
        status: parsed.status,
        respostaAdmin: parsed.respostaAdmin ?? undefined,
        resolvidoEm: resolvido ? new Date() : null,
        resolvidoPorId: resolvido ? customData.userId ?? null : null,
      },
      include: adminInclude,
    });

    return ResponseHandler(res, "Relato atualizado.", item);
  } catch (error) {
    handleError(res, error);
  }
}

export async function deleteRelatoBugAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await requireSuperAdmin(req, res))) return;
    const id = Number(req.params.id);
    if (!id || isNaN(id)) throw new Error("Id do relato inválido.");
    await prisma.relatoBug.delete({ where: { id } });
    return ResponseHandler(res, "Relato removido.", { id });
  } catch (error) {
    handleError(res, error);
  }
}
