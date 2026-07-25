import { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";

const relatoBugSchema = z.object({
  titulo: z.string().trim().min(3, "Descreva o problema em poucas palavras.").max(160),
  descricao: z
    .string()
    .trim()
    .min(10, "Detalhe o que aconteceu (mínimo 10 caracteres).")
    .max(4000, "Descrição muito longa."),
  severidade: z
    .enum(["BAIXA", "MEDIA", "ALTA", "CRITICA"])
    .optional()
    .default("MEDIA"),
  rota: z.string().trim().max(255).optional().nullable(),
});

/**
 * Cria um relato de bug enviado por qualquer usuário logado da conta.
 * Fica disponível para o CEO (superadmin) acompanhar no modo administração.
 */
export const criarRelatoBug = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const parsed = relatoBugSchema.parse(req.body);

    const userAgent = String(req.headers["user-agent"] || "").slice(0, 500) || null;

    const relato = await prisma.relatoBug.create({
      data: {
        contaId: customData.contaId,
        usuarioId: customData.userId ?? null,
        titulo: parsed.titulo,
        descricao: parsed.descricao,
        severidade: parsed.severidade,
        rota: parsed.rota || null,
        userAgent,
      },
    });

    return ResponseHandler(res, "Relato enviado com sucesso. Obrigado!", relato);
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * Lista os relatos de bug enviados pela conta do usuário logado, para que ele
 * acompanhe o status dos próprios relatos.
 */
export const listarMeusRelatosBug = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const relatos = await prisma.relatoBug.findMany({
      where: { contaId: customData.contaId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        titulo: true,
        descricao: true,
        severidade: true,
        status: true,
        respostaAdmin: true,
        resolvidoEm: true,
        createdAt: true,
      },
    });
    return ResponseHandler(res, "Relatos recuperados.", relatos);
  } catch (error) {
    handleError(res, error);
  }
};
