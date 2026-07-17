import { NextFunction, Request, Response } from "express";
import { assertSuperAdmin } from "../controllers/administracao/assinantes";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { handleError } from "../utils/handleError";

/**
 * Exige a flag `superAdmin` nas rotas da plataforma.
 *
 * Fica no router, e não dentro de cada controller, porque a política falha por
 * omissão: uma rota nova em /gerencia precisaria lembrar de repetir a checagem
 * e, sem ela, responderia dados de todos os assinantes a qualquer autenticado.
 *
 * Deve vir depois de blockImpersonation: em sessão de suporte o token carrega o
 * userId do root do assinante, então a consulta aqui olharia a flag do root e
 * não a de quem realmente abriu a sessão.
 */
export async function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;

    if (!(await assertSuperAdmin(customData.userId))) {
      return res.status(403).json({
        status: 403,
        message: "Usuário não tem permissão para acessar a área de gerência.",
        title: "Acesso negado",
      });
    }

    return next();
  } catch (err) {
    return handleError(res, err);
  }
}
