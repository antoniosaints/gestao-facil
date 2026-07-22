import { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { ResponseHandler } from "../../utils/response";
import { generateText } from "../../services/ia/iaTextService";
import { montarKpisNegocio } from "../../services/ia/iaAnalyticsService";
import { getThisMonth } from "../dashboard/hooks";
import { handleIaError } from "./helpers";

const schema = z.object({
  inicio: z.string().optional().nullable(),
  fim: z.string().optional().nullable(),
});

export const insightsDashboard = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, parsed.error.issues[0].message, null, 400);
    }

    const mes = getThisMonth();
    const inicio = parsed.data.inicio ? new Date(parsed.data.inicio) : mes.start;
    const fim = parsed.data.fim ? new Date(parsed.data.fim) : mes.end;
    if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
      return ResponseHandler(res, "Período inválido", null, 400);
    }

    const kpis = await montarKpisNegocio(contaId, inicio, fim);

    const prompt = [
      "KPIs do negócio no período (em JSON):",
      JSON.stringify(kpis, null, 2),
      "",
      "Analise esses números e escreva um panorama para o dono do negócio.",
    ].join("\n");

    const systemInstruction = [
      "Você é um analista de negócios de um ERP para pequenas empresas brasileiras.",
      "Responda em português do Brasil, em Markdown, de forma objetiva e prática, usando estas seções:",
      "## Resumo (2-3 frases sobre o período)",
      "## Destaques (bullets com os pontos positivos e de atenção)",
      "## Recomendações (bullets com ações concretas)",
      "Baseie-se apenas nos números fornecidos; não invente dados. Seja direto e evite jargão.",
    ].join("\n");

    const { text, usage } = await generateText({
      contaId,
      feature: "insights_dashboard",
      prompt,
      systemInstruction,
    });

    return ResponseHandler(res, "Sucesso", { text: text.trim(), kpis, usage });
  } catch (err) {
    handleIaError(res, err);
  }
};
