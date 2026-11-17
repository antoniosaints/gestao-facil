import type { Content, Part } from "@google/generative-ai";
import type { CustomData } from "../../helpers/getCustomRequest";
import type {
  ActionPreview,
  CoreIaActions,
  PreparedAction,
} from "./coreIaActions";
import {
  isWriteTool,
  requiredToolPermission,
  type WriteToolName,
} from "./coreIaToolPolicy";
import { textOnlyHistory } from "./coreIaProtocol";

type ModelReply = {
  response: {
    functionCalls(): { name: string; args: any }[] | undefined;
    text(): string;
  };
};
export type AgentDependencies = {
  chat: {
    sendMessage(
      message: string | Part[],
      requireTool?: boolean,
    ): Promise<ModelReply>;
    getHistory(): Promise<Content[]>;
  };
  actions: CoreIaActions;
  authorize(request: CustomData, level: number): Promise<boolean>;
  prepare(
    name: WriteToolName,
    args: unknown,
    request: CustomData,
  ): Promise<PreparedAction>;
  read(name: string, args: unknown, request: CustomData): Promise<any>;
  knownTools: Set<string>;
};
// Only this orchestrator consumes model calls. Writes are proposals, never executions.
export async function runCoreIaAgent(
  message: string | Part[],
  request: CustomData,
  deps: AgentDependencies,
) {
  let result = await deps.chat.sendMessage(message);
  const proposals: ActionPreview[] = [];
  const seen = new Set<string>();
  let count = 0;
  let repairedPreview = false;
  for (let round = 0; round < 8; round++) {
    const calls = result.response.functionCalls();
    if (!calls?.length) {
      const text = result.response.text().trim();
      // A model may imitate an earlier server preview instead of calling a tool.
      // Repair once; never present that prose as an actionable/successful write.
      if (
        !proposals.length &&
        /revis[aã]o pendente|cadastro conclu[ií]do|cadastrad[oa] com sucesso/i.test(
          text,
        )
      ) {
        if (!repairedPreview) {
          repairedPreview = true;
          result = await deps.chat.sendMessage(
            "Nenhuma ferramenta preparou uma revisão para este pedido. Chame a ferramenta de cadastro com os dados informados para preparar a revisão. Não reproduza revisões anteriores nem afirme que houve gravação.",
            true,
          );
          continue;
        }
        return {
          reply:
            "Não foi possível preparar a revisão deste cadastro. Nenhum registro foi gravado. Reenvie o pedido com os dados que deseja cadastrar.",
          pendingActions: [],
          history: textOnlyHistory(await deps.chat.getHistory()),
        };
      }
      return {
        reply: proposals.length
          ? "Revise os dados abaixo. O cadastro será realizado ao confirmar."
          : text ||
            "Não consegui concluir a resposta. Tente reformular o pedido.",
        pendingActions: proposals,
        history: textOnlyHistory(await deps.chat.getHistory()),
      };
    }
    if (calls.length > 12)
      return {
        reply: "Há muitas operações no mesmo pedido. Divida em partes menores.",
        pendingActions: [],
        history: textOnlyHistory(await deps.chat.getHistory()),
      };
    const responses: Part[] = [];
    for (const call of calls) {
      let response: any;
      const signature = JSON.stringify([call.name, call.args]);
      try {
        if (++count > 20)
          throw new Error(
            "Limite de consultas atingido. Divida o pedido em partes.",
          );
        if (!deps.knownTools.has(call.name))
          throw new Error("Ferramenta não disponível.");
        if (!(await deps.authorize(request, requiredToolPermission(call.name))))
          throw new Error("Você não tem permissão para esta operação.");
        if (seen.has(signature))
          throw new Error(
            "Esta chamada já foi realizada. Use o resultado anterior ou peça esclarecimento.",
          );
        seen.add(signature);
        if (isWriteTool(call.name)) {
          if (proposals.length)
            throw new Error(
              "Já há uma operação para revisão. Aguarde a confirmação antes de preparar outra.",
            );
          const prepared = await deps.prepare(call.name, call.args, request);
          const preview = await deps.actions.propose(prepared, request);
          proposals.push(preview);
          response = {
            status: "aguardando_confirmacao",
            mensagem:
              "Nenhum cadastro foi realizado. A interface exibirá a revisão com botão Confirmar. Não peça confirmação em texto.",
            resumo: preview.fields,
          };
        } else {
          if (/^(create|update|delete|save|remove)/i.test(call.name))
            throw new Error("Escrita sem revisão não permitida.");
          response = await deps.read(call.name, call.args, request);
        }
      } catch (error: any) {
        response = {
          error:
            error?.name === "ZodError"
              ? "Dados inválidos ou incompletos. Confira os campos obrigatórios e os valores antes de preparar o cadastro."
              : /Prisma|Database/i.test(error?.name || "")
                ? "Não foi possível consultar os dados. Tente novamente."
                : error?.message || "Falha na operação.",
        };
      }
      responses.push({ functionResponse: { name: call.name, response } });
    }
    // A preview is terminal: no additional model round can hide it or fail after it was stored.
    if (proposals.length)
      return {
        reply:
          "Revise os dados abaixo. O cadastro será realizado ao confirmar.",
        pendingActions: proposals,
        history: textOnlyHistory([
          ...(await deps.chat.getHistory()),
          {
            role: "model",
            parts: [
              {
                text: `Revisão pendente, sem gravação: ${proposals[0].title}. ${proposals[0].fields.map((field) => `${field.label}: ${field.value}`).join("; ")}`,
              },
            ],
          },
        ]),
      };
    result = await deps.chat.sendMessage(responses);
  }
  return {
    reply: "A consulta atingiu o limite de etapas. Divida o pedido em partes.",
    pendingActions: proposals,
    history: textOnlyHistory(await deps.chat.getHistory()),
  };
}
