import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../utils/dotenv";

export function authenticateJWT(
  req: Request,
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
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (decoded) {
      return next();
    }
    return res.status(401).json({
      status: 401,
      message: "Token inválido ou expirado",
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
