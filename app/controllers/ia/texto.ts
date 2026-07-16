import { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { ResponseHandler } from "../../utils/response";
import { generateText } from "../../services/ia/iaTextService";
import { handleIaError } from "./helpers";

// ---------------- Descrição de produto ----------------
const descricaoSchema = z.object({
  nome: z.string().min(1, "Informe o nome do produto"),
  categoria: z.string().optional().nullable(),
  atributos: z.string().optional().nullable(),
  descricaoAtual: z.string().optional().nullable(),
});

export const gerarDescricaoProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = descricaoSchema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, parsed.error.issues[0].message, null, 400);
    }
    const { nome, categoria, atributos, descricaoAtual } = parsed.data;

    const prompt = [
      `Produto: ${nome}`,
      categoria ? `Categoria: ${categoria}` : null,
      atributos ? `Atributos/observações: ${atributos}` : null,
      descricaoAtual ? `Descrição atual (para melhorar): ${descricaoAtual}` : null,
      "",
      "Escreva uma descrição comercial atraente e objetiva (2 a 4 frases) para este produto.",
    ]
      .filter(Boolean)
      .join("\n");

    const systemInstruction =
      "Você é um redator de e-commerce para pequenos negócios no Brasil. Escreva em português do Brasil, tom comercial e claro. Não invente especificações técnicas, medidas ou garantias que não foram informadas. Responda apenas com a descrição, sem títulos nem aspas.";

    const { text, usage } = await generateText({
      contaId,
      feature: "produto_descricao",
      prompt,
      systemInstruction,
    });

    return ResponseHandler(res, "Sucesso", { text: text.trim(), usage });
  } catch (err) {
    handleIaError(res, err);
  }
};

// ---------------- Assistente de texto reutilizável ----------------
const textoSchema = z.object({
  modo: z.enum(["gerar", "melhorar", "resumir"]),
  texto: z.string().optional().nullable(),
  contexto: z.string().optional().nullable(),
});

export const assistenteTexto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = textoSchema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, parsed.error.issues[0].message, null, 400);
    }
    const { modo, texto, contexto } = parsed.data;

    if ((modo === "melhorar" || modo === "resumir") && !texto?.trim()) {
      return ResponseHandler(res, "Informe o texto para " + modo, null, 400);
    }

    const instrucaoPorModo: Record<string, string> = {
      gerar: "Gere um texto adequado ao contexto informado.",
      melhorar:
        "Reescreva o texto abaixo com melhor clareza, ortografia e tom profissional, mantendo o sentido e o idioma.",
      resumir: "Resuma o texto abaixo de forma objetiva, mantendo os pontos essenciais.",
    };

    const prompt = [
      contexto ? `Contexto: ${contexto}` : null,
      texto ? `Texto:\n${texto}` : null,
      "",
      instrucaoPorModo[modo],
    ]
      .filter(Boolean)
      .join("\n");

    const systemInstruction =
      "Você é um assistente de escrita para um sistema de gestão (ERP) brasileiro. Escreva em português do Brasil, tom profissional e conciso. Responda apenas com o texto final, sem comentários, títulos ou aspas.";

    const { text, usage } = await generateText({
      contaId,
      feature: "texto_assistente",
      prompt,
      systemInstruction,
    });

    return ResponseHandler(res, "Sucesso", { text: text.trim(), usage });
  } catch (err) {
    handleIaError(res, err);
  }
};

// ---------------- Redigir Ordem de Serviço ----------------
const osSchema = z.object({
  tipo: z.enum(["laudo", "mensagem_cliente"]),
  problema: z.string().min(1, "Informe o problema/relato"),
  itens: z.string().optional().nullable(),
  cliente: z.string().optional().nullable(),
});

export const redigirOrdemServico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = osSchema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, parsed.error.issues[0].message, null, 400);
    }
    const { tipo, problema, itens, cliente } = parsed.data;

    const objetivo =
      tipo === "laudo"
        ? "Escreva um laudo técnico objetivo (diagnóstico e serviço executado/recomendado) para registro interno da ordem de serviço."
        : "Escreva uma mensagem cordial e clara para enviar ao cliente informando o diagnóstico e os próximos passos da ordem de serviço.";

    const prompt = [
      cliente ? `Cliente: ${cliente}` : null,
      `Problema relatado: ${problema}`,
      itens ? `Itens/serviços: ${itens}` : null,
      "",
      objetivo,
    ]
      .filter(Boolean)
      .join("\n");

    const systemInstruction =
      "Você é um técnico/atendente de uma assistência que redige textos de ordem de serviço em português do Brasil. Seja objetivo e profissional. Não invente peças, valores ou prazos que não foram informados. Responda apenas com o texto final.";

    const { text, usage } = await generateText({
      contaId,
      feature: "os_redigir",
      prompt,
      systemInstruction,
    });

    return ResponseHandler(res, "Sucesso", { text: text.trim(), usage });
  } catch (err) {
    handleIaError(res, err);
  }
};
