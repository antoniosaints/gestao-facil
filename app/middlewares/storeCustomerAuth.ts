import type { NextFunction, Request, Response } from "express";
import { decodeStoreAccessToken } from "../services/loja/lojaAuthService";

export async function optionalStoreCustomer(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) (req as any).storeCustomer = await decodeStoreAccessToken(header.slice(7));
  next();
}

export async function requireStoreCustomer(req: Request, res: Response, next: NextFunction) {
  await optionalStoreCustomer(req, res, () => undefined);
  if (!(req as any).storeCustomer) return res.status(401).json({ status: 401, message: "Sessão do cliente inválida", data: null, error: { code: "unauthorized" } });
  next();
}
