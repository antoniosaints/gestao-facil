import { Request } from "express";

export interface CustomData {
  userId: number;
  email: string;
  permissao: string;
  contaId: number;
  contaStatus: string;
  // Preenchido só quando a requisição vem de uma sessão de suporte do superadmin
  // (token com claim `imp`). Ausente em sessões normais.
  impersonacao?: {
    sessaoId: number;
    superAdminId: number;
  };
}

export interface CustomRequest extends Request {
  customData: CustomData;
}

export function getCustomRequest(req: Request): CustomRequest {
  return req as CustomRequest;
}
