import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { normalizeFidelityIds } from "../../services/restaurante/loyalty";
import { prisma } from "../../utils/prisma";

const programSchema = z.object({
  ativo: z.boolean().default(false),
  pedidosMeta: z.coerce.number().int().min(2).max(100).default(6),
  categoriaIds: z.array(z.coerce.number().int().positive()).max(100).default([]),
  catalogoItemIds: z.array(z.coerce.number().int().positive()).max(100).default([]),
  premioCatalogoItemId: z.coerce.number().int().positive().nullable(),
  descontoPercentual: z.coerce.number().min(1).max(100).default(100),
  version: z.coerce.number().int().positive().optional(),
}).superRefine((value, context) => {
  if (value.ativo && !value.premioCatalogoItemId) {
    context.addIssue({ code: "custom", path: ["premioCatalogoItemId"], message: "Selecione o produto que sera premiado." });
  }
});

const requestId = (req: Request) => String(req.headers["x-request-id"] || randomUUID());
const ok = (req: Request, res: Response, data: unknown, status = 200) => res.status(status).json({ data, requestId: requestId(req) });
const fail = (req: Request, res: Response, status: number, code: string, message: string, details?: unknown) => res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: requestId(req) } });

export async function fidelityOptions(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const [items, categories] = await Promise.all([
    prisma.restauranteCatalogoItem.findMany({
      where: { contaId, disponivel: true }, orderBy: { ordem: "asc" },
      include: { Produto: { select: { nome: true, imagem: true } } },
    }),
    prisma.produtoCategoria.findMany({ where: { contaId, status: "ATIVO" }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  return ok(req, res, {
    itens: items.map((item) => ({ id: item.id, nome: item.nomePublico || item.Produto?.nome || "Item do cardapio", imagem: item.imagem || item.Produto?.imagem || null })),
    categorias: categories,
  });
}

export async function getFidelityProgram(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const program = await prisma.restauranteFidelidadePrograma.findUnique({ where: { contaId } });
  return ok(req, res, program ? {
    ...program,
    categoriaIds: normalizeFidelityIds(program.categoriaIdsJson),
    catalogoItemIds: normalizeFidelityIds(program.catalogoItemIdsJson),
  } : null);
}

export async function saveFidelityProgram(req: Request, res: Response) {
  const parsed = programSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Revise as regras de fidelidade.", parsed.error.flatten());
  const { contaId } = getCustomRequest(req).customData;
  const current = await prisma.restauranteFidelidadePrograma.findUnique({ where: { contaId } });
  if (current && parsed.data.version && current.version !== parsed.data.version) {
    return fail(req, res, 409, "version_conflict", "A fidelidade foi alterada em outra sessao.");
  }
  const allItemIds = [...new Set([...parsed.data.catalogoItemIds, ...(parsed.data.premioCatalogoItemId ? [parsed.data.premioCatalogoItemId] : [])])];
  if (allItemIds.length) {
    const count = await prisma.restauranteCatalogoItem.count({ where: { contaId, id: { in: allItemIds } } });
    if (count !== allItemIds.length) return fail(req, res, 422, "invalid_fidelity_items", "Um produto selecionado nao pertence ao cardapio.");
  }
  if (parsed.data.categoriaIds.length) {
    const count = await prisma.produtoCategoria.count({ where: { contaId, id: { in: parsed.data.categoriaIds }, status: "ATIVO" } });
    if (count !== new Set(parsed.data.categoriaIds).size) return fail(req, res, 422, "invalid_fidelity_categories", "Uma categoria selecionada nao pertence a conta.");
  }
  const { version: _version, categoriaIds, catalogoItemIds, ...data } = parsed.data;
  const saved = current
    ? await prisma.restauranteFidelidadePrograma.update({ where: { id: current.id }, data: { ...data, categoriaIdsJson: normalizeFidelityIds(categoriaIds), catalogoItemIdsJson: normalizeFidelityIds(catalogoItemIds), version: { increment: 1 } } })
    : await prisma.restauranteFidelidadePrograma.create({ data: { ...data, contaId, categoriaIdsJson: normalizeFidelityIds(categoriaIds), catalogoItemIdsJson: normalizeFidelityIds(catalogoItemIds) } });
  return ok(req, res, { ...saved, categoriaIds: normalizeFidelityIds(saved.categoriaIdsJson), catalogoItemIds: normalizeFidelityIds(saved.catalogoItemIdsJson) }, current ? 200 : 201);
}
