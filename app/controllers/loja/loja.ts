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
import { randomUUID } from "crypto";
import { ensureLojaConfig } from "../../services/loja/lojaConfigService";

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const configSchema = z.object({
  slug: z.string().trim().min(3).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  template: z.enum(["ESSENCIAL", "EDITORIAL", "IMPACTO"]).optional(),
  themeVersion: z.number().int().min(1).optional(),
  themeConfig: z.object({
    font: z.enum(["Inter", "system", "Georgia"]),
    radius: z.enum(["none", "small", "medio", "grande"]),
    gridDensity: z.enum(["compacta", "confortavel", "arejada"]),
    cardStyle: z.enum(["plano", "elevado", "contorno"]),
    bannerHeight: z.enum(["pequeno", "medio", "grande"]),
    bannerOverlay: z.number().min(0).max(80),
    bannerFocalPoint: z.enum(["center", "top", "bottom", "left", "right"]),
  }).optional(),
  corPrimaria: z.string().regex(HEX_COLOR, "Cor primária inválida").optional(),
  corSecundaria: z.string().regex(HEX_COLOR, "Cor secundária inválida").optional(),
  headerEstilo: z.enum(["padrao", "centralizado", "banner"]).optional(),
  bannerTitulo: z.string().trim().max(120).optional().nullable(),
  bannerSubtitulo: z.string().trim().max(200).optional().nullable(),
  mensagemBoasVindas: z.string().trim().max(500).optional().nullable(),
  mostrarPrecos: z.boolean().optional(),
  mostrarDisponibilidade: z.boolean().optional(),
  ocultarEsgotados: z.boolean().optional(),
  quickAdd: z.boolean().optional(),
  pedidoWhatsapp: z.boolean().optional(),
  pagamentoOnline: z.boolean().optional(),
  gatewayPreferido: z.enum(["MERCADOPAGO", "ABACATEPAY"]).optional().nullable(),
  permitirLogin: z.boolean().optional(),
  permitirCadastro: z.boolean().optional(),
  permitirCheckoutVisitante: z.boolean().optional(),
  retiradaAtiva: z.boolean().optional(),
  entregaLocalAtiva: z.boolean().optional(),
  taxaEntrega: z.coerce.number().min(0).max(99999).optional(),
  freteGratisAcima: z.coerce.number().min(0).max(999999).optional().nullable(),
  barraAvisoAtiva: z.boolean().optional(),
  barraAvisoTexto: z.string().trim().max(160).optional().nullable(),
});

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

    const mobile = req.query.tipo === "mobile";
    const oldReference = mobile ? config.bannerMobileUrl : config.bannerUrl;

    const key = buildScopedUploadKey(
      customData.contaId,
      `loja/conta_${customData.contaId}`,
      `banner-${mobile ? "mobile" : "desktop"}-${randomUUID()}.${processed.extension}`,
    );
    const file = await uploadPublicFile({
      key,
      body: processed.buffer,
      contentType: processed.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    });

    const updated = await prisma.lojaVirtualConfig.update({
      where: { contaId: customData.contaId },
      data: mobile ? { bannerMobileUrl: file.reference } : { bannerUrl: file.reference },
    });

    // A referência nova já está persistida; apagar a antiga é apenas uma limpeza best-effort.
    if (oldReference) await deleteStoredFile(oldReference).catch(() => undefined);

    return ResponseHandler(res, "Banner atualizado com sucesso", {
      bannerUrl: mobile ? updated.bannerMobileUrl : updated.bannerUrl,
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
    const mobile = req.query.tipo === "mobile";
    const reference = mobile ? config?.bannerMobileUrl : config?.bannerUrl;
    if (reference) {
      await prisma.lojaVirtualConfig.update({
        where: { contaId: customData.contaId },
        data: mobile ? { bannerMobileUrl: null } : { bannerUrl: null },
      });
      await deleteStoredFile(reference).catch(() => undefined);
    }
    return ResponseHandler(res, "Banner removido", { bannerUrl: null });
  } catch (error) {
    handleError(res, error);
  }
};
