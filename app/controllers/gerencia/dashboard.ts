import Decimal from "decimal.js";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { Request, Response } from "express";
import { format } from "date-fns";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";

export const getResumoFaturasAssinantesSistema = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const faturas = await prisma.faturasContas.findMany({
        where: {
            status: "PAGO"
        }
    });

    // Estrutura com quantidade e valor
    const resumo: Record<string, { total: Decimal; quantidade: number }> = {};

    faturas.forEach((row) => {
      const mes = format(row.vencimento, "MM/yyyy");

      if (!resumo[mes]) {
        resumo[mes] = { total: new Decimal(0), quantidade: 0 };
      }

      resumo[mes].total = resumo[mes].total.plus(new Decimal(row.valor));
      resumo[mes].quantidade += 1;
    });

    const labels = Object.keys(resumo).sort();
    const valores = labels.map((mes) => resumo[mes].total.toNumber());
    const quantidades = labels.map((mes) => resumo[mes].quantidade);

    const chartData = {
      labels,
      datasets: [
        {
          label: "Valor Total (R$)",
          data: valores,
          backgroundColor: "#1ae010",
          borderColor: "#1ae010",
          yAxisID: "y1",
        },
        {
          label: "Qtd",
          data: quantidades,
          backgroundColor: "#1037e3",
          borderColor: "#1037e3",
          yAxisID: "y2",
        },
      ],
    };

    ResponseHandler(res, "Resumo mensal gerado com sucesso", chartData);
  } catch (err: any) {
    handleError(res, err);
  }
};