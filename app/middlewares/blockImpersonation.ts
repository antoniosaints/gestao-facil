import { NextFunction, Request, Response } from "express";
import { getCustomRequest } from "../helpers/getCustomRequest";

/**
 * Barra sessões de suporte nas rotas da plataforma (/api/admin/*).
 *
 * Durante o suporte o token carrega a identidade do root do assinante, então
 * o assertSuperAdmin — que consulta o banco só pelo userId — voltaria a passar
 * caso esse root fosse superAdmin, reabrindo o painel CEO em nome do assinante
 * e permitindo impersonação em cadeia.
 *
 * Fica no router e não dentro de cada controller porque a política já falha por
 * omissão hoje: cada rota nova precisaria lembrar de repetir a checagem.
 */
export function blockImpersonation(
  req: Request,
  res: Response,
  next: NextFunction
): any {
  if (getCustomRequest(req).customData?.impersonacao) {
    return res.status(403).json({
      status: 403,
      message:
        "Ações da plataforma não estão disponíveis durante uma sessão de suporte. Encerre o suporte para voltar ao painel CEO.",
      title: "Acesso negado",
    });
  }

  return next();
}
