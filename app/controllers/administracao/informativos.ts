import { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { getIO } from "../../utils/socket";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { assertSuperAdmin } from "./assinantes";
import { isInformativoVisible } from "../../services/informativos/informativoPolicy";

const optionalDate = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? undefined : new Date(String(value)),
  z.date().optional(),
);

const informativoSchema = z.object({
  titulo: z.string().trim().min(3).max(120),
  mensagem: z.string().trim().min(3).max(2000),
  integracao: z.string().trim().min(2).max(60).default("Sistema"),
  severidade: z.enum(["INFO", "ATENCAO", "INDISPONIBILIDADE"]),
  situacao: z.enum(["INVESTIGANDO", "MONITORANDO", "RESOLVIDO"]),
  escopo: z.enum(["GLOBAL", "MODULO", "CONTAS"]),
  moduloCodigo: z.string().trim().max(80).optional().nullable(),
  contaIds: z.array(z.coerce.number().int().positive()).max(500).default([]),
  inicioEm: optionalDate,
  fimEm: optionalDate,
}).superRefine((data, ctx) => {
  if (data.escopo === "MODULO" && !data.moduloCodigo) {
    ctx.addIssue({ code: "custom", path: ["moduloCodigo"], message: "Selecione o app afetado." });
  }
  if (data.escopo === "CONTAS" && !data.contaIds.length) {
    ctx.addIssue({ code: "custom", path: ["contaIds"], message: "Selecione ao menos uma conta." });
  }
  if (data.inicioEm && data.fimEm && data.fimEm <= data.inicioEm) {
    ctx.addIssue({ code: "custom", path: ["fimEm"], message: "O encerramento deve ser posterior ao início." });
  }
});

async function requireSuperAdmin(req: Request, res: Response) {
  const customData = getCustomRequest(req).customData;
  if (!(await assertSuperAdmin(customData.userId))) {
    res.status(403).json({ message: "Usuário sem permissão para gerenciar informativos." });
    return null;
  }
  return customData;
}

function emitInformativosUpdated() {
  getIO().emit("informativos:updated", { updatedAt: new Date().toISOString() });
}

function buildData(data: z.infer<typeof informativoSchema>) {
  return {
    titulo: data.titulo,
    mensagem: data.mensagem,
    integracao: data.integracao,
    severidade: data.severidade,
    situacao: data.situacao,
    escopo: data.escopo,
    moduloCodigo: data.escopo === "MODULO" ? data.moduloCodigo : null,
    inicioEm: data.inicioEm || null,
    fimEm: data.fimEm || null,
  };
}

const adminInclude = {
  CriadoPor: { select: { id: true, nome: true } },
  contas: { include: { Conta: { select: { id: true, nome: true } } } },
  _count: { select: { leituras: true } },
} as const;

export async function listInformativosAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await requireSuperAdmin(req, res))) return;
    const items = await prisma.informativoSistema.findMany({
      include: adminInclude,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    return ResponseHandler(res, "Informativos recuperados", items);
  } catch (error) {
    handleError(res, error);
  }
}

export async function createInformativoAdmin(req: Request, res: Response): Promise<any> {
  try {
    const customData = await requireSuperAdmin(req, res);
    if (!customData) return;
    const parsed = informativoSchema.parse(req.body);
    const item = await prisma.informativoSistema.create({
      data: {
        ...buildData(parsed),
        criadoPorId: customData.userId,
        contas: parsed.escopo === "CONTAS"
          ? { createMany: { data: [...new Set(parsed.contaIds)].map((contaId) => ({ contaId })) } }
          : undefined,
      },
      include: adminInclude,
    });
    return ResponseHandler(res, "Informativo criado como rascunho", item, 201);
  } catch (error) {
    handleError(res, error);
  }
}

export async function updateInformativoAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await requireSuperAdmin(req, res))) return;
    const id = Number(req.params.id);
    const parsed = informativoSchema.parse(req.body);
    const item = await prisma.$transaction(async (tx) => {
      await tx.informativoConta.deleteMany({ where: { informativoId: id } });
      return tx.informativoSistema.update({
        where: { id },
        data: {
          ...buildData(parsed),
          contas: parsed.escopo === "CONTAS"
            ? { createMany: { data: [...new Set(parsed.contaIds)].map((contaId) => ({ contaId })) } }
            : undefined,
        },
        include: adminInclude,
      });
    });
    if (item.status === "PUBLICADO" || item.status === "RESOLVIDO") emitInformativosUpdated();
    return ResponseHandler(res, "Informativo atualizado", item);
  } catch (error) {
    handleError(res, error);
  }
}

export async function publishInformativoAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await requireSuperAdmin(req, res))) return;
    const item = await prisma.informativoSistema.update({
      where: { id: Number(req.params.id) },
      data: { status: "PUBLICADO", publicadoEm: new Date(), resolvidoEm: null },
      include: adminInclude,
    });
    emitInformativosUpdated();
    return ResponseHandler(res, "Informativo publicado", item);
  } catch (error) {
    handleError(res, error);
  }
}

export async function resolveInformativoAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await requireSuperAdmin(req, res))) return;
    const item = await prisma.informativoSistema.update({
      where: { id: Number(req.params.id) },
      data: { status: "RESOLVIDO", situacao: "RESOLVIDO", resolvidoEm: new Date() },
      include: adminInclude,
    });
    emitInformativosUpdated();
    return ResponseHandler(res, "Informativo marcado como resolvido", item);
  } catch (error) {
    handleError(res, error);
  }
}

export async function archiveInformativoAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await requireSuperAdmin(req, res))) return;
    const item = await prisma.informativoSistema.update({
      where: { id: Number(req.params.id) },
      data: { status: "ARQUIVADO" },
      include: adminInclude,
    });
    emitInformativosUpdated();
    return ResponseHandler(res, "Informativo arquivado", item);
  } catch (error) {
    handleError(res, error);
  }
}

async function getContaModuloCodes(contaId: number) {
  const modulos = await prisma.moduloOnConta.findMany({
    where: { contaId, status: "ATIVO" },
    select: { Modulos: { select: { codigo: true } } },
  });
  return modulos.map((item) => item.Modulos.codigo);
}

export async function listInformativosAtivos(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const now = new Date();
    const moduloCodes = await getContaModuloCodes(customData.contaId);
    const items = await prisma.informativoSistema.findMany({
      where: {
        status: { in: ["PUBLICADO", "RESOLVIDO"] },
      },
      include: {
        leituras: { where: { usuarioId: customData.userId }, select: { lidoEm: true, dispensadoEm: true } },
        contas: { select: { contaId: true } },
      },
      orderBy: [{ resolvidoEm: "desc" }, { publicadoEm: "desc" }, { updatedAt: "desc" }],
    });
    const visibleItems = items
      .filter((item) => isInformativoVisible({
        ...item,
        contaIds: item.contas.map((conta) => conta.contaId),
      }, { now, contaId: customData.contaId, moduloCodes }))
      .map(({ leituras, contas: _contas, ...item }) => ({
        ...item,
        lido: Boolean(leituras[0]?.lidoEm),
        dispensado: Boolean(leituras[0]?.dispensadoEm),
      }));
    return ResponseHandler(res, "Informativos ativos recuperados", visibleItems);
  } catch (error) {
    handleError(res, error);
  }
}

async function updateLeitura(req: Request, res: Response, dispensar: boolean): Promise<any> {
  const customData = getCustomRequest(req).customData;
  const informativoId = Number(req.params.id);
  const leitura = await prisma.informativoLeitura.upsert({
    where: { informativoId_usuarioId: { informativoId, usuarioId: customData.userId } },
    create: {
      informativoId,
      usuarioId: customData.userId,
      contaId: customData.contaId,
      lidoEm: new Date(),
      dispensadoEm: dispensar ? new Date() : null,
    },
    update: {
      lidoEm: new Date(),
      ...(dispensar ? { dispensadoEm: new Date() } : {}),
    },
  });
  return ResponseHandler(res, dispensar ? "Informativo dispensado" : "Informativo marcado como lido", leitura);
}

export async function markInformativoRead(req: Request, res: Response): Promise<any> {
  try {
    return await updateLeitura(req, res, false);
  } catch (error) {
    handleError(res, error);
  }
}

export async function dismissInformativo(req: Request, res: Response): Promise<any> {
  try {
    return await updateLeitura(req, res, true);
  } catch (error) {
    handleError(res, error);
  }
}
