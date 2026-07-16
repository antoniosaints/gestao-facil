import { Request, Response } from "express";
import { z } from "zod";
import { WhatsAppMensagemDirecao } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { generateText } from "../../services/ia/iaTextService";
import { handleIaError } from "./helpers";

const schema = z.object({
  conversaId: z.coerce.number().int().positive("Informe a conversa"),
});

// Quantas mensagens recentes usar como contexto (mesmo padrão do autoatendimento).
const HISTORICO_TAKE = 20;

// Carrega a conversa (validando a conta) + as últimas mensagens em ordem cronológica,
// já formatadas como transcrição "Cliente:/Atendente:".
async function carregarContexto(contaId: number, conversaId: number) {
  const conversa = await prisma.whatsAppConversa.findFirst({
    where: { id: conversaId, contaId },
    include: {
      Contato: { select: { nome: true } },
      Cliente: { select: { nome: true } },
    },
  });
  if (!conversa) return null;

  const mensagens = await prisma.whatsAppMensagem.findMany({
    where: { contaId, conversaId, apagadaEm: null },
    orderBy: { createdAt: "desc" },
    take: HISTORICO_TAKE,
    select: { direcao: true, conteudo: true, tipo: true },
  });

  const nomeCliente =
    conversa.Contato?.nome?.trim() ||
    conversa.Cliente?.nome?.trim() ||
    conversa.telefone ||
    "Cliente";

  const transcricao = mensagens
    .reverse()
    .map((m) => {
      const quem = m.direcao === WhatsAppMensagemDirecao.SAIDA ? "Atendente" : nomeCliente;
      const texto = m.conteudo?.trim() || `(${(m.tipo || "mídia").toLowerCase()})`;
      return `${quem}: ${texto}`;
    })
    .join("\n");

  return { conversa, nomeCliente, transcricao, total: mensagens.length };
}

// ---------------- Sugerir resposta ao atendente ----------------
export const sugerirRespostaAtendimento = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, parsed.error.issues[0].message, null, 400);
    }

    const ctx = await carregarContexto(contaId, parsed.data.conversaId);
    if (!ctx) return ResponseHandler(res, "Conversa não encontrada", null, 404);
    if (!ctx.total) {
      return ResponseHandler(res, "A conversa ainda não tem mensagens", null, 400);
    }

    const prompt = [
      `Cliente: ${ctx.nomeCliente}`,
      "",
      "Conversa até aqui (mais antiga primeiro):",
      ctx.transcricao,
      "",
      "Escreva a próxima resposta que o ATENDENTE deve enviar ao cliente, dando continuidade à conversa.",
    ].join("\n");

    const systemInstruction =
      "Você ajuda um atendente humano de uma empresa brasileira a responder clientes no WhatsApp. Escreva em português do Brasil, tom cordial, direto e profissional, como uma mensagem pronta para enviar. Não invente preços, prazos, dados ou promessas que não aparecem na conversa. Responda apenas com o texto da mensagem, sem saudações de sistema, títulos ou aspas.";

    const { text, usage } = await generateText({
      contaId,
      feature: "atendimento_sugestao",
      prompt,
      systemInstruction,
    });

    return ResponseHandler(res, "Sucesso", { text: text.trim(), usage });
  } catch (err) {
    handleIaError(res, err);
  }
};

// ---------------- Resumir conversa ----------------
export const resumoAtendimento = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, parsed.error.issues[0].message, null, 400);
    }

    const ctx = await carregarContexto(contaId, parsed.data.conversaId);
    if (!ctx) return ResponseHandler(res, "Conversa não encontrada", null, 404);
    if (!ctx.total) {
      return ResponseHandler(res, "A conversa ainda não tem mensagens", null, 400);
    }

    const prompt = [
      `Cliente: ${ctx.nomeCliente}`,
      "",
      "Conversa (mais antiga primeiro):",
      ctx.transcricao,
      "",
      "Resuma esta conversa de atendimento em poucos tópicos objetivos: o que o cliente quer, o que já foi tratado e o que ficou pendente/próximo passo.",
    ].join("\n");

    const systemInstruction =
      "Você resume conversas de atendimento ao cliente para um atendente humano. Escreva em português do Brasil, de forma objetiva e curta, em tópicos (use '- '). Não invente informações que não estão na conversa. Responda apenas com o resumo.";

    const { text, usage } = await generateText({
      contaId,
      feature: "atendimento_resumo",
      prompt,
      systemInstruction,
    });

    return ResponseHandler(res, "Sucesso", { text: text.trim(), usage });
  } catch (err) {
    handleIaError(res, err);
  }
};
