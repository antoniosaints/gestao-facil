import { Request, Response, NextFunction } from "express";
import { env } from "../utils/dotenv";
import { JwtUtil } from "../utils/jwt";
import { prisma } from "../utils/prisma";
import { CustomData } from "../helpers/getCustomRequest";

export async function authenticateJWT(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> {
  if (env.REQUIRED_JWT === "false") {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      status: 401,
      message: "Token não fornecido",
      title: "Não autorizado",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = JwtUtil.verify(token);
    if (decoded) {
      // Sessão de suporte: o JWT é stateless, então sem consultar a linha de
      // auditoria o "encerrar"/"revogar" seria decorativo e o token continuaria
      // valendo até expirar. A query extra só acontece em sessões de suporte.
      let impersonacao: CustomData["impersonacao"];
      if (decoded.imp === true) {
        const sessaoId = Number(decoded.impSessao);
        const sessao = Number.isInteger(sessaoId)
          ? await prisma.acessoSuporteLog.findUnique({ where: { id: sessaoId } })
          : null;

        const sessaoValida =
          sessao &&
          !sessao.encerradoEm &&
          sessao.expiraEm > new Date() &&
          sessao.contaId === decoded.contaId &&
          sessao.usuarioAlvoId === decoded.id &&
          sessao.superAdminId === decoded.impBy;

        if (!sessaoValida) {
          return res.status(401).json({
            status: 401,
            supportEnded: true,
            message: "Sessão de suporte encerrada ou expirada",
            title: "Acesso negado",
          });
        }

        impersonacao = {
          sessaoId: sessao.id,
          superAdminId: sessao.superAdminId,
        };
      }

      const conta = await prisma.contas.findUnique({
        where: {
          id: decoded.contaId,
        },
      });

      (req as Request & { customData: CustomData }).customData = {
        userId: decoded.id,
        email: decoded.email,
        permissao: decoded.permissao,
        contaId: decoded.contaId,
        contaStatus: conta?.status ?? "BLOQUEADO",
        impersonacao,
      };

      return next();
    }

    return res.status(401).json({
      status: 401,
      message: "Token inválido ou expirado, tente novamente mais tarde",
      title: "Acesso negado",
    });
  } catch (err) {
    return res.status(403).json({
      status: 403,
      message: "Token inválido ou expirado",
      title: "Acesso negado",
    });
  }
}
