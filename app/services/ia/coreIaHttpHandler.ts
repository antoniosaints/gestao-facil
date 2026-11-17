import type { Request, Response } from "express";
import type { CustomData } from "../../helpers/getCustomRequest";
import { coreIaChatSchema, textOnlyHistory } from "./coreIaProtocol";

export type CoreIaHttpDependencies = {
  access(request: CustomData): Promise<boolean>;
  quota(contaId: number): Promise<void>;
  chat(
    request: CustomData,
    prompt: string,
    history: any[],
    image?: any,
    audio?: any,
  ): Promise<any>;
  decide(
    id: string,
    decision: "confirm" | "cancel",
    request: CustomData,
  ): Promise<{ reply?: string; actionId: string }>;
  onError(res: Response, error: unknown): void;
};
export function createCoreIaChatHandler(deps: CoreIaHttpDependencies) {
  return async (req: Request, res: Response): Promise<any> => {
    try {
      const custom = (req as Request & { customData: CustomData }).customData;
      if (!custom?.contaId || !custom.userId)
        return res.status(401).json({ message: "Autenticação necessária." });
      if (!(await deps.access(custom)))
        return res
          .status(403)
          .json({ message: "O app CORE IA não está ativo no seu plano." });
      const parsed = coreIaChatSchema.safeParse(req.body);
      if (!parsed.success)
        return res
          .status(422)
          .json({
            message: parsed.error.issues
              .map((issue) => issue.message)
              .join(", "),
          });
      const data = parsed.data;
      let result: any;
      if (data.confirmation) {
        result = await deps.decide(
          data.confirmation.id,
          data.confirmation.decision,
          custom,
        );
        result = {
          ...result,
          pendingActions: [],
          history: textOnlyHistory([
            ...data.history,
            {
              role: "user",
              parts: [
                {
                  text:
                    data.confirmation.decision === "confirm"
                      ? "Confirmar operação revisada"
                      : "Cancelar operação revisada",
                },
              ],
            },
            {
              role: "model",
              parts: [{ text: result.reply || "Operação processada." }],
            },
          ]),
        };
      } else {
        await deps.quota(custom.contaId);
        result = await deps.chat(
          custom,
          data.prompt,
          data.history,
          data.image,
          data.audio,
        );
      }
      return res
        .status(200)
        .json({ status: 200, message: "Sucesso", data: result });
    } catch (error) {
      deps.onError(res, error);
    }
  };
}
