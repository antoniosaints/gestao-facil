import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";

const secaoInclude = {
  produtos: {
    orderBy: [{ ordem: "asc" as const }, { id: "asc" as const }],
    include: {
      ProdutoBase: {
        select: {
          id: true,
          nome: true,
          variantes: { where: { ehPadrao: true }, take: 1, select: { imagem: true } },
        },
      },
    },
  },
};

function mapSecao(secao: any) {
  return {
    id: secao.id,
    nome: secao.nome,
    ordem: secao.ordem,
    ativo: secao.ativo,
    produtos: (secao.produtos ?? []).map((item: any) => ({
      produtoBaseId: item.produtoBaseId,
      nome: item.ProdutoBase?.nome ?? "Produto",
      imagem: item.ProdutoBase?.variantes?.[0]?.imagem ?? null,
    })),
  };
}

// Lista as seções manuais da conta (admin), com os produtos base de cada uma.
export const listSecoes = async (req: Request, res: Response): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const secoes = await prisma.lojaSecao.findMany({
      where: { contaId },
      orderBy: [{ ordem: "asc" }, { id: "asc" }],
      include: secaoInclude,
    });
    return ResponseHandler(res, "Seções da loja", secoes.map(mapSecao));
  } catch (error) {
    handleError(res, error);
  }
};

const createSchema = z.object({ nome: z.string().trim().min(2).max(60) });

export const createSecao = async (req: Request, res: Response): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return ResponseHandler(res, "Dados inválidos", parsed.error.issues, 400);

    const last = await prisma.lojaSecao.findFirst({ where: { contaId }, orderBy: { ordem: "desc" }, select: { ordem: true } });
    const secao = await prisma.lojaSecao.create({
      data: { contaId, nome: parsed.data.nome, ordem: (last?.ordem ?? 0) + 1 },
      include: secaoInclude,
    });
    return ResponseHandler(res, "Seção criada", mapSecao(secao), 201);
  } catch (error) {
    handleError(res, error);
  }
};

const updateSchema = z.object({
  nome: z.string().trim().min(2).max(60).optional(),
  ativo: z.boolean().optional(),
  ordem: z.number().int().min(0).optional(),
});

export const updateSecao = async (req: Request, res: Response): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const id = Number(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return ResponseHandler(res, "Dados inválidos", parsed.error.issues, 400);

    const existing = await prisma.lojaSecao.findFirst({ where: { id, contaId }, select: { id: true } });
    if (!existing) return ResponseHandler(res, "Seção não encontrada", null, 404);

    const secao = await prisma.lojaSecao.update({ where: { id }, data: parsed.data, include: secaoInclude });
    return ResponseHandler(res, "Seção atualizada", mapSecao(secao));
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteSecao = async (req: Request, res: Response): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const id = Number(req.params.id);
    const existing = await prisma.lojaSecao.findFirst({ where: { id, contaId }, select: { id: true } });
    if (!existing) return ResponseHandler(res, "Seção não encontrada", null, 404);
    await prisma.lojaSecao.delete({ where: { id } });
    return ResponseHandler(res, "Seção removida", { id });
  } catch (error) {
    handleError(res, error);
  }
};

const addProdutoSchema = z.object({ produtoBaseId: z.number().int().positive() });

export const addProdutoSecao = async (req: Request, res: Response): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const secaoId = Number(req.params.id);
    const parsed = addProdutoSchema.safeParse(req.body);
    if (!parsed.success) return ResponseHandler(res, "Dados inválidos", parsed.error.issues, 400);

    const secao = await prisma.lojaSecao.findFirst({ where: { id: secaoId, contaId }, select: { id: true } });
    if (!secao) return ResponseHandler(res, "Seção não encontrada", null, 404);
    const base = await prisma.produtoBase.findFirst({ where: { id: parsed.data.produtoBaseId, contaId }, select: { id: true } });
    if (!base) return ResponseHandler(res, "Produto não encontrado", null, 404);

    const last = await prisma.lojaSecaoProduto.findFirst({ where: { secaoId }, orderBy: { ordem: "desc" }, select: { ordem: true } });
    await prisma.lojaSecaoProduto.upsert({
      where: { secaoId_produtoBaseId: { secaoId, produtoBaseId: base.id } },
      create: { contaId, secaoId, produtoBaseId: base.id, ordem: (last?.ordem ?? 0) + 1 },
      update: {},
    });

    const updated = await prisma.lojaSecao.findUniqueOrThrow({ where: { id: secaoId }, include: secaoInclude });
    return ResponseHandler(res, "Produto adicionado à seção", mapSecao(updated));
  } catch (error) {
    handleError(res, error);
  }
};

export const removeProdutoSecao = async (req: Request, res: Response): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const secaoId = Number(req.params.id);
    const produtoBaseId = Number(req.params.produtoBaseId);
    const secao = await prisma.lojaSecao.findFirst({ where: { id: secaoId, contaId }, select: { id: true } });
    if (!secao) return ResponseHandler(res, "Seção não encontrada", null, 404);

    await prisma.lojaSecaoProduto.deleteMany({ where: { secaoId, produtoBaseId } });
    const updated = await prisma.lojaSecao.findUniqueOrThrow({ where: { id: secaoId }, include: secaoInclude });
    return ResponseHandler(res, "Produto removido da seção", mapSecao(updated));
  } catch (error) {
    handleError(res, error);
  }
};
