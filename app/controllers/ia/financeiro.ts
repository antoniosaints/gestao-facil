import { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { generateText } from "../../services/ia/iaTextService";
import { handleIaError } from "./helpers";

const schema = z.object({
  descricao: z.string().min(1, "Informe a descrição do lançamento"),
  valor: z.coerce.number().optional().nullable(),
  tipo: z.enum(["RECEITA", "DESPESA"]).optional().nullable(),
});

// Extrai o primeiro objeto JSON de um texto (a IA às vezes embrulha em ``` ou texto).
function parseJsonLike(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Sugere a categoria financeira mais provável (dentre as já cadastradas na conta) para um
// lançamento, a partir da descrição/valor/tipo. Retorna a categoria existente ou null.
export const categorizarLancamento = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, parsed.error.issues[0].message, null, 400);
    }
    const { descricao, valor, tipo } = parsed.data;

    const categorias = await prisma.categoriaFinanceiro.findMany({
      where: { contaId },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });
    if (!categorias.length) {
      return ResponseHandler(res, "Nenhuma categoria cadastrada", { categoria: null }, 200);
    }

    const prompt = [
      `Lançamento a classificar:`,
      `- Descrição: ${descricao}`,
      valor != null ? `- Valor: ${valor}` : null,
      tipo ? `- Tipo: ${tipo === "RECEITA" ? "Receita (entrada)" : "Despesa (saída)"}` : null,
      "",
      "Categorias disponíveis (escolha exatamente uma pelo nome, ou null se nenhuma servir):",
      categorias.map((c) => `- ${c.nome}`).join("\n"),
      "",
      'Responda apenas com JSON no formato: {"categoria": "<nome exato da categoria>"} ou {"categoria": null}.',
    ]
      .filter(Boolean)
      .join("\n");

    const systemInstruction =
      "Você classifica lançamentos financeiros de um ERP nas categorias já existentes da empresa. Escolha a categoria mais provável estritamente entre as fornecidas, pelo nome exato. Se nenhuma se encaixar, retorne null. Responda somente com o JSON pedido, sem comentários.";

    const { text, usage } = await generateText({
      contaId,
      feature: "financeiro_categorizar",
      prompt,
      systemInstruction,
      json: true,
    });

    const data = parseJsonLike(text);
    const nomeSugerido = typeof data?.categoria === "string" ? data.categoria.trim() : null;
    const match = nomeSugerido
      ? categorias.find((c) => c.nome.trim().toLowerCase() === nomeSugerido.toLowerCase())
      : null;

    return ResponseHandler(res, "Sucesso", {
      categoria: match ? { id: match.id, nome: match.nome } : null,
      usage,
    });
  } catch (err) {
    handleIaError(res, err);
  }
};
