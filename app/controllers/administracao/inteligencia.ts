import { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { assertSuperAdmin } from "./assinantes";
import { iaPlatformService } from "../../services/ia/iaPlatformService";

async function ensureSuperAdmin(req: Request, res: Response) {
  const customData = getCustomRequest(req).customData;
  if (!(await assertSuperAdmin(customData.userId))) {
    res.status(403).json({ message: "Apenas o super administrador pode gerenciar a IA da plataforma." });
    return false;
  }
  return true;
}

const chaveSchema = z.object({
  nome: z.string().min(2, "Nome da chave é obrigatório"),
  apiKey: z.string().min(10, "Informe a chave de API").optional(),
  provider: z.string().min(2).optional(),
  ativo: z.boolean().optional(),
  isPadrao: z.boolean().optional(),
});

const modeloSchema = z.object({
  modelId: z.string().min(2, "Identificador do modelo é obrigatório (ex.: gemini-2.0-flash)"),
  nome: z.string().min(2, "Nome do modelo é obrigatório"),
  provider: z.string().min(2).optional(),
  ativo: z.boolean().optional(),
});

const coreConfigSchema = z.object({
  provider: z.string().min(2).optional(),
  modelId: z.string().min(2, "Informe o modelo do Core IA (ex.: gemini-2.0-flash)").optional(),
  apiKey: z.string().min(10, "Informe a chave de API").optional(),
  systemPrompt: z.string().optional(),
  ativo: z.boolean().optional(),
});

// ---------------- Chaves API ----------------
export async function listChavesIaAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;
    res.json({ data: await iaPlatformService.listChaves() });
  } catch (error) {
    handleError(res, error);
  }
}

export async function createChaveIaAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;
    const data = chaveSchema.parse(req.body);
    if (!data.apiKey) return res.status(400).json({ message: "Informe a chave de API" });
    res.status(201).json({ message: "Chave criada", data: await iaPlatformService.createChave(data) });
  } catch (error) {
    handleError(res, error);
  }
}

export async function updateChaveIaAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;
    const data = chaveSchema.partial().parse(req.body);
    res.json({ message: "Chave atualizada", data: await iaPlatformService.updateChave(Number(req.params.id), data as any) });
  } catch (error) {
    handleError(res, error);
  }
}

export async function deleteChaveIaAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;
    res.json({ message: "Chave removida", data: await iaPlatformService.removeChave(Number(req.params.id)) });
  } catch (error) {
    handleError(res, error);
  }
}

// ---------------- Modelos ----------------
export async function listModelosIaAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;
    res.json({ data: await iaPlatformService.listModelos() });
  } catch (error) {
    handleError(res, error);
  }
}

export async function createModeloIaAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;
    const data = modeloSchema.parse(req.body);
    res.status(201).json({ message: "Modelo criado", data: await iaPlatformService.createModelo(data) });
  } catch (error) {
    handleError(res, error);
  }
}

export async function updateModeloIaAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;
    const data = modeloSchema.partial().parse(req.body);
    res.json({ message: "Modelo atualizado", data: await iaPlatformService.updateModelo(Number(req.params.id), data) });
  } catch (error) {
    handleError(res, error);
  }
}

export async function deleteModeloIaAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;
    res.json({ message: "Modelo removido", data: await iaPlatformService.removeModelo(Number(req.params.id)) });
  } catch (error) {
    handleError(res, error);
  }
}

// ---------------- Core IA (assistente interno) ----------------
export async function getCoreConfigIaAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;
    res.json({ data: await iaPlatformService.getCoreConfig() });
  } catch (error) {
    handleError(res, error);
  }
}

export async function saveCoreConfigIaAdmin(req: Request, res: Response): Promise<any> {
  try {
    if (!(await ensureSuperAdmin(req, res))) return;
    const data = coreConfigSchema.parse(req.body);
    res.json({ message: "Configuração do Core IA salva", data: await iaPlatformService.saveCoreConfig(data) });
  } catch (error) {
    handleError(res, error);
  }
}
