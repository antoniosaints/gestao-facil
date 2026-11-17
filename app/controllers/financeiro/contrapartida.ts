import type { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { handleError } from "../../utils/handleError";
import { criarLancamentoComContrapartida } from "../../services/financeiro/lancamentoContrapartidaService";
import { sendFinanceiroUpdated } from "../../hooks/financeiro/socket";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import { enqueueWhatsAppNotificationByPreference } from "../../services/notifications/whatsappNotificationQueueService";

export async function criarReceitaDespesa(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const result = await criarLancamentoComContrapartida(
      prisma,
      contaId,
      req.body,
    );
    if (!result.replay) {
      // Only after commit; notification failures cannot undo or duplicate the pair.
      const aviso = {
        title: "Receita e despesa criadas.",
        body: "Os dois lançamentos financeiros foram registrados com as mesmas condições.",
      };
      void Promise.allSettled([
        enqueuePushNotification(aviso, contaId),
        enqueueWhatsAppNotificationByPreference(
          "NOVO_LANCAMENTO",
          aviso,
          contaId,
        ),
      ]).then((results) => {
        if (results.some((item) => item.status === "rejected"))
          console.error(
            "[financeiro] Notificação da contrapartida não entregue.",
          );
      });
    }
    // Persistence has committed. A missing websocket must not report a saved pair as failed.
    try {
      if (!result.replay)
        sendFinanceiroUpdated(contaId, { reason: "receita-despesa-criadas" });
    } catch (error) {
      console.error(
        "[financeiro] Falha ao publicar atualização da contrapartida",
        error instanceof Error ? error.name : "Error",
      );
    }
    res
      .status(result.replay ? 200 : 201)
      .json({ message: "Receita e despesa criadas com sucesso.", ...result });
  } catch (error) {
    handleError(res, error);
  }
}
