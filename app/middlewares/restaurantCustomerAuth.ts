import type { NextFunction, Request, Response } from "express";
import { decodeRestaurantCustomerAccessToken } from "../services/restaurante/customerAuth";

export async function optionalRestaurantCustomer(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    (req as any).restaurantCustomer = await decodeRestaurantCustomerAccessToken(header.slice(7));
  }
  next();
}

export async function requireRestaurantCustomer(req: Request, res: Response, next: NextFunction) {
  await optionalRestaurantCustomer(req, res, () => undefined);
  if (!(req as any).restaurantCustomer) {
    return res.status(401).json({ error: { code: "unauthorized", message: "Sessão do cliente inválida" } });
  }
  next();
}
