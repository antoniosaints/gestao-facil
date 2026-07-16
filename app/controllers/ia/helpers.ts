import { Response } from "express";
import { handleError } from "../../utils/handleError";
import { IaQuotaExcededError } from "../../services/ia/iaUsageService";

// Trata erros das features de IA: quota excedida vira 429; o resto segue o handleError padrão.
export function handleIaError(res: Response, err: any) {
  if (err instanceof IaQuotaExcededError) {
    return res.status(429).json({ message: err.message });
  }
  return handleError(res, err);
}
