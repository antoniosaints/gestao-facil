import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { ZodError } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { comboChannelSchema, comboSchema, comboUpdateSchema } from "../../schemas/combos";
import {
  ComboError,
  createCombo,
  deleteCombo,
  getCombo,
  listComboOptions,
  listCombos,
  updateCombo,
} from "../../services/combos/comboService";
import {
  buildScopedUploadKey,
  deleteStoredFile,
  uploadPublicFile,
} from "../../services/uploads/fileStorageService";
import { downscaleImage } from "../../services/uploads/imageProcessingService";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";

function respondError(res: Response, error: unknown) {
  if (error instanceof ComboError) {
    return res.status(error.status).json({
      status: error.status,
      message: error.message,
      data: null,
      error: { code: error.code, message: error.message, details: error.details },
    });
  }
  if (error instanceof ZodError) {
    return res.status(422).json({
      status: 422,
      message: "Dados inválidos.",
      data: null,
      error: { code: "combo_validation_failed", message: "Dados inválidos.", details: error.flatten() },
    });
  }
  throw error;
}

export async function index(req: Request, res: Response) {
  try {
    const contaId = getCustomRequest(req).customData.contaId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || req.query.pageSize) || 20));
    const ativo = req.query.ativo === undefined ? undefined : String(req.query.ativo) === "true";
    return ResponseHandler(res, "Combos encontrados.", await listCombos(contaId, {
      page,
      limit,
      ativo,
      search: String(req.query.search || "").trim() || undefined,
    }));
  } catch (error) { return respondError(res, error); }
}

export async function show(req: Request, res: Response) {
  try {
    return ResponseHandler(res, "Combo encontrado.", await getCombo(getCustomRequest(req).customData.contaId, Number(req.params.id)));
  } catch (error) { return respondError(res, error); }
}

export async function store(req: Request, res: Response) {
  try {
    const input = comboSchema.parse(req.body);
    const combo = await createCombo(getCustomRequest(req).customData.contaId, input);
    res.setHeader("Location", `/api/combos/${combo.id}`);
    return ResponseHandler(res, "Combo criado.", combo, 201);
  } catch (error) { return respondError(res, error); }
}

export async function update(req: Request, res: Response) {
  try {
    const contaId = getCustomRequest(req).customData.contaId;
    const patch = comboUpdateSchema.parse(req.body);
    const current = await getCombo(contaId, Number(req.params.id));
    const input = comboSchema.parse({
      nome: current.nome,
      descricao: current.descricao,
      imagem: current.imagem,
      preco: Number(current.preco),
      ativo: current.ativo,
      mostrarNoPdv: current.mostrarNoPdv,
      mostrarOnline: current.mostrarOnline,
      componentes: current.componentes.map((item) => ({
        tipo: item.tipo,
        id: item.produtoId ?? item.servicoId,
        quantidade: item.quantidade,
      })),
      ...patch,
    });
    return ResponseHandler(res, "Combo atualizado.", await updateCombo(contaId, Number(req.params.id), input));
  } catch (error) { return respondError(res, error); }
}

export async function destroy(req: Request, res: Response) {
  try {
    const contaId = getCustomRequest(req).customData.contaId;
    const id = Number(req.params.id);
    const combo = await getCombo(contaId, id);
    await deleteCombo(contaId, id);
    if (combo.imagem) {
      await deleteStoredFile(combo.imagem).catch(() => undefined);
    }
    return res.status(204).send();
  } catch (error) { return respondError(res, error); }
}

export async function uploadImage(req: Request, res: Response) {
  let uploadedReference: string | null = null;
  try {
    const contaId = getCustomRequest(req).customData.contaId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return ResponseHandler(res, "Combo inválido.", null, 400);
    }
    if (!req.file) {
      return ResponseHandler(res, "Nenhuma imagem enviada.", null, 400);
    }
    if (!req.file.mimetype?.startsWith("image/")) {
      return ResponseHandler(res, "O arquivo enviado não é uma imagem.", null, 400);
    }

    const combo = await getCombo(contaId, id);
    const processed = await downscaleImage(req.file.buffer, req.file.mimetype, {
      maxDimension: 1280,
      quality: 72,
    });
    const key = buildScopedUploadKey(
      contaId,
      `combos/combo_${combo.id}`,
      `combo-${combo.id}-${randomUUID()}.${processed.extension}`,
    );
    const file = await uploadPublicFile({
      key,
      body: processed.buffer,
      contentType: processed.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    });
    uploadedReference = file.reference;

    await prisma.combo.update({
      where: { id: combo.id, contaId },
      data: { imagem: file.reference },
    });
    uploadedReference = null;

    if (combo.imagem) {
      await deleteStoredFile(combo.imagem).catch(() => undefined);
    }

    return ResponseHandler(res, "Imagem do combo enviada com sucesso.", {
      id: combo.id,
      imagem: file.reference,
      imagemUrl: file.url,
    });
  } catch (error) {
    if (uploadedReference) {
      await deleteStoredFile(uploadedReference).catch(() => undefined);
    }
    return respondError(res, error);
  }
}

export async function deleteImage(req: Request, res: Response) {
  try {
    const contaId = getCustomRequest(req).customData.contaId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return ResponseHandler(res, "Combo inválido.", null, 400);
    }

    const combo = await getCombo(contaId, id);
    if (combo.imagem) {
      await prisma.combo.update({
        where: { id: combo.id, contaId },
        data: { imagem: null },
      });
      await deleteStoredFile(combo.imagem).catch(() => undefined);
    }

    return ResponseHandler(res, "Imagem do combo removida com sucesso.", { id: combo.id });
  } catch (error) {
    return respondError(res, error);
  }
}

export async function options(req: Request, res: Response) {
  try {
    const channel = comboChannelSchema.parse(String(req.query.canal || "VENDA"));
    const items = await listComboOptions(
      getCustomRequest(req).customData.contaId,
      channel,
      String(req.query.search || "").trim() || undefined,
    );
    return res.json({ results: items });
  } catch (error) { return respondError(res, error); }
}
