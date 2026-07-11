import { Request, Response } from "express";
import Decimal from "decimal.js";
import { z } from "zod";

import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { assertSuperAdmin } from "./assinantes";
import { syncContaRecurringBilling } from "../../services/contas/storeModulesService";

async function ensureSuperAdmin(req: Request, res: Response) {
  const customData = getCustomRequest(req).customData;
  const isSuperAdmin = await assertSuperAdmin(customData.userId);
  if (!isSuperAdmin) {
    res.status(403).json({
      message: "Usuário não tem permissão para gerenciar os apps.",
    });
    return null;
  }
  return customData;
}

export const listModulosAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;

    const modulos = await prisma.modulosAdicionais.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        codigo: true,
        nome: true,
        descricao: true,
        categoria: true,
        preco: true,
        desconto: true,
        status: true,
        _count: {
          select: {
            moduloOnContas: {
              where: { status: { in: ["ATIVO", "PENDENTE_ATIVACAO"] as any } },
            },
          },
        },
      },
    });

    return res.json({
      data: modulos.map((modulo) => ({
        id: modulo.id,
        codigo: modulo.codigo,
        nome: modulo.nome,
        descricao: modulo.descricao,
        categoria: modulo.categoria,
        preco: Number(modulo.preco || 0),
        desconto: Number(modulo.desconto || 0),
        status: modulo.status,
        contasAtivas: modulo._count.moduloOnContas,
      })),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const updateModuloSchema = z.object({
  preco: z.coerce.number().min(0, "Preço inválido."),
  desconto: z.coerce.number().min(0).optional(),
  status: z.boolean().optional(),
});

export const updateModuloAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;

    const moduleId = Number(req.params.id);
    if (!moduleId) {
      return res.status(400).json({ message: "App inválido." });
    }

    const parsed = updateModuloSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const modulo = await prisma.modulosAdicionais.update({
      where: { id: moduleId },
      data: {
        preco: new Decimal(parsed.data.preco).toFixed(2),
        ...(parsed.data.desconto !== undefined
          ? { desconto: new Decimal(parsed.data.desconto).toFixed(2) }
          : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      },
    });

    // Preço global mudou: propaga para o valor por conta dos vínculos ativos/pendentes
    // e re-sincroniza a mensalidade (base + apps) de cada conta afetada.
    const vinculos = await prisma.moduloOnConta.findMany({
      where: {
        moduloId: moduleId,
        status: { in: ["ATIVO", "PENDENTE_ATIVACAO"] as any },
      },
      select: { contaId: true },
    });

    await prisma.moduloOnConta.updateMany({
      where: {
        moduloId: moduleId,
        status: { in: ["ATIVO", "PENDENTE_ATIVACAO"] as any },
      },
      data: {
        valorAdicional: new Decimal(parsed.data.preco).toFixed(2),
      },
    });

    const contaIds = Array.from(new Set(vinculos.map((v) => v.contaId)));
    for (const contaId of contaIds) {
      try {
        await syncContaRecurringBilling(contaId);
      } catch (error) {
        console.error(`[admin] Falha ao re-sincronizar conta ${contaId} após mudança de preço do app`, error);
      }
    }

    return res.json({
      message: `Preço do app ${modulo.nome} atualizado. ${contaIds.length} conta(s) sincronizada(s).`,
      data: {
        id: modulo.id,
        preco: Number(modulo.preco || 0),
        desconto: Number(modulo.desconto || 0),
        status: modulo.status,
        contasAtualizadas: contaIds.length,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};
