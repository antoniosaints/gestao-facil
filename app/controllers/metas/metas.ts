import { Request, Response } from "express";
import Decimal from "decimal.js";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { buildMetaResumo } from "../../services/metas/metaCalculationService";
import {
  canManageMetas,
  type MetricaMeta,
  type PeriodicidadeMeta,
  type TipoMeta,
} from "../../services/metas/metaPolicy";

const tiposMeta: TipoMeta[] = ["VENDAS", "SERVICOS", "FINANCEIRO"];
const metricasMeta: MetricaMeta[] = ["VALOR", "QUANTIDADE"];
const periodicidadesMeta: PeriodicidadeMeta[] = ["MENSAL", "TRIMESTRAL", "ANUAL", "PERSONALIZADO"];
const financeiroTipos = ["RECEITA", "DESPESA"] as const;
const metaSummaryInclude = {
  categoriasFinanceiras: {
    include: { Categoria: { select: { id: true, nome: true } } },
  },
} as const;

export async function listarMetas(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const metas = await prisma.meta.findMany({
      where: { contaId },
      orderBy: [{ ativo: "desc" }, { createdAt: "desc" }],
      include: metaSummaryInclude,
    });

    const data = await Promise.all(metas.map((meta) => buildMetaResumo(prisma, meta as any)));
    return ResponseHandler(res, "Metas encontradas.", data);
  } catch (error) {
    handleError(res, error);
  }
}

export async function resumoMetas(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const metas = await prisma.meta.findMany({
      where: { contaId, ativo: true },
      orderBy: [{ updatedAt: "desc" }],
      take: 8,
      include: metaSummaryInclude,
    });

    const data = await Promise.all(metas.map((meta) => buildMetaResumo(prisma, meta as any)));
    return ResponseHandler(res, "Resumo de metas.", data);
  } catch (error) {
    handleError(res, error);
  }
}

export async function getMeta(req: Request, res: Response): Promise<any> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Informe uma meta válida." });
    }

    const meta = await prisma.meta.findFirst({ where: { id, contaId }, include: metaSummaryInclude });
    if (!meta) {
      return res.status(404).json({ message: "Meta não encontrada." });
    }

    return ResponseHandler(res, "Meta encontrada.", await buildMetaResumo(prisma, meta as any));
  } catch (error) {
    handleError(res, error);
  }
}

export async function salvarMeta(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;

    if (!canManageMetas(customData.permissao)) {
      return res.status(403).json({ message: "Apenas administradores podem gerenciar metas." });
    }

    const payload = parseMetaPayload(req.body);
    await validarCategoriasFinanceiras(customData.contaId, payload.categoriaIds);
    const { categoriaIds, ...dadosMeta } = payload;
    const id = req.body?.id ? Number(req.body.id) : null;

    if (id && (!Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ message: "Informe uma meta válida." });
    }

    if (id) {
      const meta = await prisma.meta.findFirst({
        where: { id, contaId: customData.contaId },
        select: { id: true },
      });

      if (!meta) {
        return res.status(404).json({ message: "Meta não encontrada." });
      }

      const updated = await prisma.meta.update({
        where: { id },
        data: {
          ...dadosMeta,
          categoriasFinanceiras: {
            deleteMany: {},
            create: categoriaIds.map((categoriaId) => ({ categoriaId })),
          },
        },
        include: metaSummaryInclude,
      });

      return ResponseHandler(res, "Meta atualizada com sucesso.", await buildMetaResumo(prisma, updated as any));
    }

    const created = await prisma.meta.create({
      data: {
        ...dadosMeta,
        contaId: customData.contaId,
        categoriasFinanceiras: {
          create: categoriaIds.map((categoriaId) => ({ categoriaId })),
        },
      },
      include: metaSummaryInclude,
    });

    return ResponseHandler(res, "Meta criada com sucesso.", await buildMetaResumo(prisma, created as any), 201);
  } catch (error) {
    handleError(res, error);
  }
}

export async function deletarMeta(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const id = Number(req.params.id);

    if (!canManageMetas(customData.permissao)) {
      return res.status(403).json({ message: "Apenas administradores podem gerenciar metas." });
    }

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Informe uma meta válida." });
    }

    const meta = await prisma.meta.findFirst({
      where: { id, contaId: customData.contaId },
      select: { id: true },
    });

    if (!meta) {
      return res.status(404).json({ message: "Meta não encontrada." });
    }

    await prisma.meta.delete({ where: { id } });
    return ResponseHandler(res, "Meta excluída com sucesso.", { id });
  } catch (error) {
    handleError(res, error);
  }
}

function parseMetaPayload(body: any) {
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  const descricao = typeof body?.descricao === "string" && body.descricao.trim()
    ? body.descricao.trim()
    : null;
  const tipo = String(body?.tipo || "").toUpperCase() as TipoMeta;
  const metrica = String(body?.metrica || "VALOR").toUpperCase() as MetricaMeta;
  const periodicidade = String(body?.periodicidade || "MENSAL").toUpperCase() as PeriodicidadeMeta;
  const valorAlvo = new Decimal(body?.valorAlvo || 0);
  const dataInicio = body?.dataInicio ? new Date(body.dataInicio) : new Date();
  const dataFim = body?.dataFim ? new Date(body.dataFim) : null;
  const financeiroTipo = body?.financeiroTipo
    ? String(body.financeiroTipo).toUpperCase()
    : tipo === "FINANCEIRO"
      ? "RECEITA"
      : null;
  const ativo = body?.ativo === undefined ? true : Boolean(body.ativo);
  const categoriaIds = parseCategoriaIds(body?.categoriaIds);

  if (!nome) {
    throw new Error("Informe o nome da meta.");
  }

  if (!tiposMeta.includes(tipo)) {
    throw new Error("Informe um tipo de meta válido.");
  }

  if (!metricasMeta.includes(metrica)) {
    throw new Error("Informe uma métrica válida.");
  }

  if (!periodicidadesMeta.includes(periodicidade)) {
    throw new Error("Informe uma periodicidade válida.");
  }

  if (valorAlvo.lte(0)) {
    throw new Error("Informe um alvo maior que zero.");
  }

  if (Number.isNaN(dataInicio.getTime())) {
    throw new Error("Informe uma data inicial válida.");
  }

  if (dataFim && Number.isNaN(dataFim.getTime())) {
    throw new Error("Informe uma data final válida.");
  }

  if (periodicidade === "PERSONALIZADO" && !dataFim) {
    throw new Error("Informe a data final para metas personalizadas.");
  }

  if (dataFim && dataFim < dataInicio) {
    throw new Error("A data final deve ser maior ou igual à data inicial.");
  }

  if (financeiroTipo && !financeiroTipos.includes(financeiroTipo as any)) {
    throw new Error("Informe um tipo financeiro válido.");
  }

  return {
    nome,
    descricao,
    tipo,
    metrica,
    periodicidade,
    valorAlvo,
    dataInicio,
    dataFim,
    financeiroTipo: tipo === "FINANCEIRO" ? financeiroTipo as any : null,
    categoriaIds: tipo === "FINANCEIRO" ? categoriaIds : [],
    ativo,
  };
}

function parseCategoriaIds(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Informe as categorias financeiras em uma lista.");

  const categoriaIds = value.map((item) => Number(item));
  if (categoriaIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("Informe categorias financeiras válidas.");
  }

  return [...new Set(categoriaIds)];
}

async function validarCategoriasFinanceiras(contaId: number, categoriaIds: number[]) {
  if (!categoriaIds.length) return;

  const total = await prisma.categoriaFinanceiro.count({
    where: { contaId, id: { in: categoriaIds } },
  });

  if (total !== categoriaIds.length) {
    throw new Error("Uma ou mais categorias financeiras não pertencem à sua conta.");
  }
}
