import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { ResponseHandler } from "../../utils/response";
import { iaUsageService } from "../../services/ia/iaUsageService";
import { handleIaError } from "./helpers";

// Uso de IA da própria conta no mês (para o indicador do cliente no Core IA).
export const meuUsoIa = async (req: Request, res: Response): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const resumo = await iaUsageService.getContaMonthlySummary(contaId);
    return ResponseHandler(res, "Sucesso", resumo);
  } catch (err) {
    handleIaError(res, err);
  }
};
