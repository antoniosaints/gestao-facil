import { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { generateText } from "../../services/ia/iaTextService";
import { handleIaError } from "./helpers";

const schema = z.object({
  dias: z.coerce.number().int().positive().max(365).optional(),
});

// Quantos produtos candidatos enviar para a IA (os mais urgentes).
const MAX_CANDIDATOS = 25;

function parseJsonArray(text: string): any[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : Array.isArray(v?.itens) ? v.itens : [];
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return [];
      }
    }
    return [];
  }
}

// Sugestão de reposição: o backend calcula deterministicamente a velocidade de venda e a
// cobertura em dias de cada produto; a IA prioriza e sugere a quantidade de compra.
export const reposicaoSugestao = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, parsed.error.issues[0].message, null, 400);
    }
    const dias = parsed.data.dias ?? 30;
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    const [produtos, saidas] = await Promise.all([
      prisma.produto.findMany({
        where: { contaId, controlaEstoque: true, status: "ATIVO" },
        select: { id: true, nome: true, nomeVariante: true, estoque: true, minimo: true, unidade: true },
      }),
      prisma.movimentacoesEstoque.groupBy({
        by: ["produtoId"],
        _sum: { quantidade: true },
        where: { contaId, tipo: "SAIDA", status: { not: "CANCELADO" }, data: { gte: desde } },
      }),
    ]);

    const saidaMap = new Map<number, number>(
      saidas.map((s) => [s.produtoId, s._sum.quantidade || 0])
    );

    // Monta os candidatos: abaixo do mínimo OU com cobertura curta (< 20 dias).
    const candidatos = produtos
      .map((p) => {
        const vendido = saidaMap.get(p.id) || 0;
        const porDia = vendido / dias;
        const coberturaDias = porDia > 0 ? Math.round(p.estoque / porDia) : null;
        const abaixoMinimo = p.estoque <= p.minimo;
        return {
          id: p.id,
          nome: [p.nome, p.nomeVariante].filter(Boolean).join(" "),
          unidade: p.unidade,
          estoque: p.estoque,
          minimo: p.minimo,
          vendidoNoPeriodo: vendido,
          porDia: Number(porDia.toFixed(2)),
          coberturaDias,
          abaixoMinimo,
        };
      })
      .filter((c) => c.abaixoMinimo || (c.coberturaDias != null && c.coberturaDias < 20))
      .sort((a, b) => {
        const aCrit = a.abaixoMinimo ? 0 : 1;
        const bCrit = b.abaixoMinimo ? 0 : 1;
        if (aCrit !== bCrit) return aCrit - bCrit;
        return (a.coberturaDias ?? 9999) - (b.coberturaDias ?? 9999);
      })
      .slice(0, MAX_CANDIDATOS);

    if (!candidatos.length) {
      return ResponseHandler(res, "Sucesso", { sugestoes: [], candidatos: [], analisadoEmDias: dias });
    }

    const prompt = [
      `Janela de análise: últimos ${dias} dias.`,
      "Produtos que precisam de atenção (JSON):",
      JSON.stringify(
        candidatos.map((c) => ({
          produtoId: c.id,
          nome: c.nome,
          unidade: c.unidade,
          estoqueAtual: c.estoque,
          estoqueMinimo: c.minimo,
          vendidoNoPeriodo: c.vendidoNoPeriodo,
          mediaVendaPorDia: c.porDia,
          coberturaEmDias: c.coberturaDias,
        })),
        null,
        2
      ),
      "",
      "Para cada produto que valha a pena repor, sugira a quantidade de compra para cobrir cerca de 30 dias de venda (considerando a média diária, o estoque atual e o mínimo).",
      'Responda apenas com um array JSON no formato: [{"produtoId": <id>, "quantidade": <inteiro>, "justificativa": "<curta>"}]. Inclua só produtos que realmente precisam de reposição.',
    ].join("\n");

    const systemInstruction =
      "Você é um analista de compras/estoque de um ERP para pequenos negócios no Brasil. Baseie-se apenas nos números fornecidos (não invente vendas). Sugira quantidades inteiras e realistas. Escreva justificativas curtas em português do Brasil. Responda somente com o array JSON pedido.";

    const { text, usage } = await generateText({
      contaId,
      feature: "estoque_reposicao",
      prompt,
      systemInstruction,
      json: true,
    });

    const byId = new Map(candidatos.map((c) => [c.id, c]));
    const sugestoes = parseJsonArray(text)
      .map((s: any) => {
        const produtoId = Number(s?.produtoId);
        const cand = byId.get(produtoId);
        const quantidade = Math.max(0, Math.round(Number(s?.quantidade) || 0));
        if (!cand || quantidade <= 0) return null;
        return {
          produtoId,
          nome: cand.nome,
          estoqueAtual: cand.estoque,
          estoqueMinimo: cand.minimo,
          coberturaDias: cand.coberturaDias,
          quantidade,
          justificativa: typeof s?.justificativa === "string" ? s.justificativa.trim() : "",
        };
      })
      .filter(Boolean);

    return ResponseHandler(res, "Sucesso", { sugestoes, analisadoEmDias: dias, usage });
  } catch (err) {
    handleIaError(res, err);
  }
};
