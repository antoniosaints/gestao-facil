import { Request, Response, NextFunction } from "express";
import { env } from "../utils/dotenv";
import { JwtUtil } from "../utils/jwt";

interface CustomData {
  userId: number;
  email: string;
}

// 2. Estenda o tipo Request
export interface CustomRequest extends Request {
  customData?: CustomData;
}

export function authenticateJWT(
  req: CustomRequest,
  res: Response,
  next: NextFunction
): any {
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
      req.customData = {
        userId: decoded.id,
        email: decoded.email,
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
