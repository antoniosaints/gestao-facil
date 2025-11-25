import { Request, Response } from "express";
import { handleError } from "../../../utils/handleError";
import { getCustomRequest } from "../../../helpers/getCustomRequest";
import { prisma } from "../../../utils/prisma";
import { ResponseHandler } from "../../../utils/response";
import { createQuadraSchema } from "../../../schemas/arena/quadras";

export const createQuadra = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const { data, success, error } = createQuadraSchema.safeParse(req.body);

    if (!success) {
      return handleError(res, error);
    }
    const quadra = await prisma.arenaQuadras.create({
      data: {
        ...data,
        contaId: customData.contaId,
      },
    });
    return ResponseHandler(res, "Quadra criada", quadra);
  } catch (error) {
    return handleError(res, error);
  }
};
export const getQuadras = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const quadras = await prisma.arenaQuadras.findMany({
      where: {
        id: req.query.id ? Number(req.query.id) : undefined,
        contaId: customData.contaId,
      },
    });
    return ResponseHandler(res, "Quadras encontradas", quadras);
  } catch (error) {
    return handleError(res, error);
  }
};
export const getQuadrasPublico = async (req: Request, res: Response): Promise<any> => {
  try {
    
    if (!req.query.contaId || isNaN(Number(req.query.contaId))) {
      return handleError(res, "conta não informada!");
    }

    const quadras = await prisma.arenaQuadras.findMany({
      where: {
        id: req.query.id ? Number(req.query.id) : undefined,
        permitirReservaOnline: true,
        active: true,
        contaId: Number(req.query.contaId)
      },
    });
    return ResponseHandler(res, "Quadras encontradas", quadras);
  } catch (error) {
    return handleError(res, error);
  }
};
export const getResumoQuadra = async (req: Request, res: Response) => {};
