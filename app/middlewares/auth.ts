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
