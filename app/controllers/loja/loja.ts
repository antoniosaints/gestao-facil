import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import {
  buildScopedUploadKey,
  deleteStoredFile,
  uploadPublicFile,
} from "../../services/uploads/fileStorageService";
import { downscaleImage } from "../../services/uploads/imageProcessingService";

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const configSchema = z.object({
  corPrimaria: z.string().regex(HEX_COLOR, "Cor primária inválida").optional(),
  corSecundaria: z.string().regex(HEX_COLOR, "Cor secundária inválida").optional(),
  headerEstilo: z.enum(["padrao", "centralizado", "banner"]).optional(),
  bannerTitulo: z.string().trim().max(120).optional().nullable(),
  bannerSubtitulo: z.string().trim().max(200).optional().nullable(),
  mensagemBoasVindas: z.string().trim().max(500).optional().nullable(),
  mostrarPrecos: z.boolean().optional(),
  pedidoWhatsapp: z.boolean().optional(),
  permitirLogin: z.boolean().optional(),
  permitirCadastro: z.boolean().optional(),
});

// Garante que a conta tenha uma config de loja (cria com os defaults na primeira vez).
async function ensureLojaConfig(contaId: number) {
  const existing = await prisma.lojaVirtualConfig.findUnique({ where: { contaId } });
  if (existing) return existing;
  return prisma.lojaVirtualConfig.create({ data: { contaId } });
}

export const getLojaConfig = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const config = await ensureLojaConfig(customData.contaId);
    return ResponseHandler(res, "Configuração da loja", config);
  } catch (error) {
    handleError(res, error);
  }
};

export const saveLojaConfig = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, "Dados inválidos", parsed.error.issues, 400);
    }

    await ensureLojaConfig(customData.contaId);
    const config = await prisma.lojaVirtualConfig.update({
      where: { contaId: customData.contaId },
      data: parsed.data,
    });

    return ResponseHandler(res, "Loja atualizada com sucesso", config);
  } catch (error) {
    handleError(res, error);
  }
};

// Upload do banner da loja: reescala/comprime (largura maior, banner é panorâmico) e sobe no R2.
export const uploadLojaBanner = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    if (!req.file) {
      return ResponseHandler(res, "Nenhuma imagem enviada", null, 400);
    }
    if (!req.file.mimetype?.startsWith("image/")) {
      return ResponseHandler(res, "O arquivo enviado não é uma imagem", null, 400);
    }

    const config = await ensureLojaConfig(customData.contaId);

    const processed = await downscaleImage(req.file.buffer, req.file.mimetype, {
      maxDimension: 1920,
      quality: 75,
    });

    if (config.bannerUrl) {
      await deleteStoredFile(config.bannerUrl).catch(() => undefined);
    }

    const key = buildScopedUploadKey(
      customData.contaId,
      `loja/conta_${customData.contaId}`,
      `banner-${customData.contaId}.${processed.extension}`,
    );
    const file = await uploadPublicFile({
      key,
      body: processed.buffer,
      contentType: processed.contentType,
      cacheControl: "public, max-age=3600",
    });

    const updated = await prisma.lojaVirtualConfig.update({
      where: { contaId: customData.contaId },
      data: { bannerUrl: file.reference },
    });

    return ResponseHandler(res, "Banner atualizado com sucesso", {
      bannerUrl: updated.bannerUrl,
      bannerPublicUrl: file.url,
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteLojaBanner = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const config = await prisma.lojaVirtualConfig.findUnique({ where: { contaId: customData.contaId } });
    if (config?.bannerUrl) {
      await deleteStoredFile(config.bannerUrl).catch(() => undefined);
      await prisma.lojaVirtualConfig.update({
        where: { contaId: customData.contaId },
        data: { bannerUrl: null },
      });
    }
    return ResponseHandler(res, "Banner removido", { bannerUrl: null });
  } catch (error) {
    handleError(res, error);
  }
};
