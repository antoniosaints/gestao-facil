import { Request, Response } from "express";
import { ReservasChartsService } from "../../../services/arena/reservasChartService";
import { getCustomRequest } from "../../../helpers/getCustomRequest";
import { handleError } from "../../../utils/handleError";
import { ResponseHandler } from "../../../utils/response";
import { endOfMonth, startOfMonth } from "date-fns";

const service = new ReservasChartsService();

export class ReservasChartsController {
  async receitaPorQuadra(req: Request, res: Response): Promise<any> {
    try {
      const customData = getCustomRequest(req).customData;
      const payload = await service.receitaPorQuadra(customData.contaId);
      return ResponseHandler(res, "Receita por quadra", payload);
    } catch (error: any) {
      return handleError(res, error);
    }
  }

  async reservasPorQuadra(req: Request, res: Response): Promise<any> {
    try {
      const { inicio, fim } = req.query;
      const customData = getCustomRequest(req).customData;
      const i = inicio ? new Date(String(inicio)) : startOfMonth(new Date());
      const f = fim ? new Date(String(fim)) : endOfMonth(new Date());
      return res.json(
        await service.reservasPorQuadra(customData.contaId, i, f)
      );
    } catch (error: any) {
      return handleError(res, error);
    }
  }

  async ocupacaoPercentual(req: Request, res: Response): Promise<any> {
    try {
      const { inicio, fim, capacidade } = req.query;
      const customData = getCustomRequest(req).customData;
      const i = inicio ? new Date(String(inicio)) : startOfMonth(new Date());
      const f = fim ? new Date(String(fim)) : endOfMonth(new Date());
      const cap = capacidade ? parseInt(String(capacidade), 10) : 12;
      return res.json(
        await service.ocupacaoPercentual(customData.contaId, i, f, cap)
      );
    } catch (error: any) {
      return handleError(res, error);
    }
  }

  async receitaMensal(req: Request, res: Response): Promise<any> {
    try {
      const customData = getCustomRequest(req).customData;
      const ano = req.query.ano
        ? parseInt(String(req.query.ano), 10)
        : new Date().getFullYear();
      return res.json(await service.receitaMensal(customData.contaId, ano));
    } catch (error: any) {
      return handleError(res, error);
    }
  }
}
