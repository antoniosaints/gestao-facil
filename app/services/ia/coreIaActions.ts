import { randomUUID } from "node:crypto";
import type { CustomData } from "../../helpers/getCustomRequest";

export type ActionPreview = {
  id: string;
  title: string;
  fields: { label: string; value: string }[];
  expiresAt: string;
};
export type PreparedAction = {
  name: string;
  args: Record<string, any>;
  title: string;
  fields: ActionPreview["fields"];
};
export type StoredAction = PreparedAction & {
  id: string;
  state: "pending" | "executing" | "done";
  expiresAt: string;
  reply?: string;
};
export interface ActionStore {
  put(key: string, action: StoredAction): Promise<void>;
  get(key: string): Promise<StoredAction | null>;
  claim(key: string): Promise<boolean>;
}
export function actionKey(request: CustomData, id: string) {
  return `core-ia:action:${request.contaId}:${request.userId}:${id}`;
}
export class CoreIaActionExpiredError extends Error {
  status = 410;
  code = "core_ia_review_expired";
}
export class CoreIaActions {
  constructor(
    private store: ActionStore,
    private execute: (
      name: string,
      args: any,
      request: CustomData,
    ) => Promise<any>,
  ) {}
  async propose(
    prepared: PreparedAction,
    request: CustomData,
  ): Promise<ActionPreview> {
    const action: StoredAction = {
      ...prepared,
      id: randomUUID(),
      state: "pending",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    await this.store.put(actionKey(request, action.id), action);
    return {
      id: action.id,
      title: action.title,
      fields: action.fields,
      expiresAt: action.expiresAt,
    };
  }
  async decide(
    id: string,
    decision: "confirm" | "cancel",
    request: CustomData,
  ) {
    const key = actionKey(request, id);
    const action = await this.store.get(key);
    if (!action)
      throw new CoreIaActionExpiredError(
        "Revisão não encontrada ou expirada. Confira o cadastro e solicite uma nova revisão.",
      );
    if (action.state === "done") return { reply: action.reply, actionId: id };
    if (action.state === "executing")
      return {
        reply:
          "Esta operação já está em processamento. Confira o cadastro antes de tentar novamente.",
        actionId: id,
      };
    if (Date.parse(action.expiresAt) < Date.now())
      throw new CoreIaActionExpiredError(
        "A revisão expirou. Solicite uma nova revisão.",
      );
    if (!(await this.store.claim(key)))
      return {
        reply: "Esta operação já está em processamento. Confira o cadastro.",
        actionId: id,
      };
    let reply = "Operação cancelada. Nenhum cadastro foi realizado.";
    if (decision === "confirm") {
      try {
        const result = await this.execute(action.name, action.args, request);
        const error = result?.error || result?.response?.error;
        reply = error
          ? `Não foi possível concluir: ${String(error)}`
          : result?.response
            ? `${action.title}: cadastro concluído com sucesso.${action.name === "createVendaNova" ? " A venda está finalizada e o pagamento pendente. Faça o faturamento/recebimento na tela de vendas." : ""}`
            : "A ferramenta não confirmou o cadastro. Confira o sistema antes de enviar novamente.";
      } catch {
        // Do not replay uncertain writes: a transaction might have committed before a network failure.
        reply =
          "Não foi possível confirmar a conclusão. Confira o cadastro no sistema antes de enviar novamente.";
      }
    }
    await this.store.put(key, { ...action, state: "done", reply });
    return { reply, actionId: id };
  }
}
