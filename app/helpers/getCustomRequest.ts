import { Request } from "express";

export interface CustomData {
  userId: number;
  email: string;
  contaId: number;
  contaStatus: string;
}

export interface CustomRequest extends Request {
  customData: CustomData;
}

export function getCustomRequest(req: Request): CustomRequest {
  return req as CustomRequest;
}
