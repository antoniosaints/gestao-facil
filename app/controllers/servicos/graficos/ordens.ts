import Decimal from "decimal.js";
import { handleError } from "../../../utils/handleError";
import { ResponseHandler } from "../../../utils/response";
import { getCustomRequest } from "../../../helpers/getCustomRequest";
import { prisma } from "../../../utils/prisma";
import { Request, Response } from "express";
import { format } from "date-fns";

export const resumoMensalOrdensServico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;

    const ordensServico = await prisma.ordensServico.findMany({
      where: { contaId: customData.contaId },
      include: { ItensOrdensServico: true },
    });

    const resumo: Record<
      string,
      {
        total: Decimal;
        faturado: Decimal;
        aberta: Decimal;
        andamento: Decimal;
        quantidade: number;
      }
    > = {};

    ordensServico.forEach((row) => {
      const mes = format(row.data, "MM/yyyy");

      if (!resumo[mes]) {
        resumo[mes] = {
          total: new Decimal(0),
          faturado: new Decimal(0),
          aberta: new Decimal(0),
          andamento: new Decimal(0),
          quantidade: 0,
        };
      }

      const totalOS = row.ItensOrdensServico.reduce((acc, item) => {
        return acc.plus(new Decimal(item.valor).times(item.quantidade));
      }, new Decimal(0));

      resumo[mes].total = resumo[mes].total.plus(totalOS);

      if (row.status === "ABERTA") resumo[mes].aberta = resumo[mes].aberta.plus(totalOS);
      if (row.status === "ANDAMENTO") resumo[mes].andamento = resumo[mes].andamento.plus(totalOS);
      if (row.status === "FATURADA") resumo[mes].faturado = resumo[mes].faturado.plus(totalOS);

      resumo[mes].quantidade++;
    });

    // ------------ FORMATO PARA CHART.JS ------------
    const labels = Object.keys(resumo).sort((a, b) => {
      const [ma, ya] = a.split("/").map(Number);
      const [mb, yb] = b.split("/").map(Number);
      return new Date(ya, ma - 1).getTime() - new Date(yb, mb - 1).getTime();
    });

    const chartData = {
      labels,
      datasets: [
        {
          label: "Total",
          data: labels.map((m) => resumo[m].total.toNumber()),
        },
        {
          label: "Faturado",
          data: labels.map((m) => resumo[m].faturado.toNumber()),
        },
        {
          label: "Aberta",
          data: labels.map((m) => resumo[m].aberta.toNumber()),
        },
        {
          label: "Andamento",
          data: labels.map((m) => resumo[m].andamento.toNumber()),
        },
        {
          label: "Quantidade",
          data: labels.map((m) => resumo[m].quantidade),
          yAxisID: "quantidade",
        },
      ],
    };

    return ResponseHandler(res, "Resumo encontrado", chartData);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};
