import { Request } from "express";

interface CustomData {
  userId: number;
  email: string;
  contaId: number;
}

export interface CustomRequest extends Request {
  customData: CustomData;
}

export function getCustomRequest(req: Request): CustomRequest {
  return req as CustomRequest;
}
