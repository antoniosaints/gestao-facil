import { Request, Response } from "express";
import { z } from "zod";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { whatsAppAgentService } from "../../services/whatsapp/whatsappAgentService";
import { iaPlatformService } from "../../services/ia/iaPlatformService";

// Agentes são gerenciados pelo admin da conta (nível 4: admin/root).
async function requireAdmin(req: Request, res: Response) {
  const customData = getCustomRequest(req).customData;
  const allowed = await hasPermission(customData, 4);
  if (!allowed) {
    ResponseHandler(res, "Apenas administradores podem gerenciar agentes de atendimento", null, 403);
    return null;
  }
  return customData;
}

const horaSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:mm)")
  .nullable()
  .optional();

const agentSchema = z.object({
  nome: z.string().min(2, "Nome do agente é obrigatório"),
  prompt: z.string().min(10, "Descreva o comportamento do agente (prompt)"),
  modelo: z.string().min(1).optional(),
  ativo: z.boolean().optional(),
  horaInicio: horaSchema,
  horaFim: horaSchema,
  diasSemana: z.string().nullable().optional(),
  instanciaIds: z.array(z.number().int().positive()).optional(),
});

const agentUpdateSchema = agentSchema.partial();

export const listAgents = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requireAdmin(req, res);
    if (!customData) return;
    const [items, models] = await Promise.all([
      whatsAppAgentService.listAgents(customData.contaId),
      iaPlatformService.getActiveModelIds(),
    ]);
    ResponseHandler(res, "Agentes encontrados", { items, models });
  } catch (error) {
    handleError(res, error);
  }
};

export const createAgent = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requireAdmin(req, res);
    if (!customData) return;
    const data = agentSchema.parse(req.body);
    const agent = await whatsAppAgentService.createAgent(customData.contaId, data);
    ResponseHandler(res, "Agente criado", agent, 201);
  } catch (error) {
    handleError(res, error);
  }
};

export const updateAgent = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requireAdmin(req, res);
    if (!customData) return;
    const data = agentUpdateSchema.parse(req.body);
    const agent = await whatsAppAgentService.updateAgent(customData.contaId, Number(req.params.id), data);
    ResponseHandler(res, "Agente atualizado", agent);
  } catch (error) {
    handleError(res, error);
  }
};

export const removeAgent = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = await requireAdmin(req, res);
    if (!customData) return;
    const result = await whatsAppAgentService.removeAgent(customData.contaId, Number(req.params.id));
    ResponseHandler(res, "Agente removido", result);
  } catch (error) {
    handleError(res, error);
  }
};
