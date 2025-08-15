import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { AsaasCreateSubscription } from "../../services/gateway/asaasService";
import { prisma } from "../../utils/prisma";
import { addDays } from "date-fns";
import { env } from "../../utils/dotenv";
import { handleError } from "../../utils/handleError";
import { hasPermission } from "../../helpers/userPermission";
import { isAccountOverdue } from "../../routers/web";

export const checkarPermissao = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const level = req.body.level;
    if (!level) {
      return res.status(200).json({ aprovado: false });
    }
    const permissao = await hasPermission(customData, Number(level));

    return res.status(200).json({ aprovado: permissao, });
  } catch (error) {
    return handleError(res, error);
  }
}
export const verificarAssinatura = async (req: Request, res: Response): Promise<any> => {
  try {
    const isDue = await isAccountOverdue(req);
    return res.status(200).json({ aprovado: !isDue });
  } catch (error) {
    return handleError(res, error);
  }
}

export const createSubscription = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const conta = await prisma.contas.findUnique({
      where: { id: customData.contaId },
    });

    if (!conta) {
      return res.status(404).json({ message: "Conta nao encontrada" });
    }

    if (conta.status === "INATIVO") {
      const assinatura = await AsaasCreateSubscription({
        billingType: "UNDEFINED",
        callback: {
          autoRedirect: true,
          successUrl: `${env.ASAAS_BASE_URL}`,
        },
        customer: conta.asaasCustomerId,
        fine: { type: "FIXED", value: 0 },
        nextDueDate: addDays(new Date(), 2).toISOString().split("T")[0],
        value: 70.0,
        cycle: "MONTHLY",
        description: "Assinatura do plano PRO do Gestão Fácil",
        externalReference: `conta-gestaofacil-${conta.id}`,
      });

      await prisma.contas.update({
        where: { id: customData.contaId },
        data: {
          asaasSubscriptionId: assinatura.id || "",
          vencimento: addDays(new Date(), 2),
          status: "BLOQUEADO",
        },
      });

      return res
        .status(200)
        .json({ message: "Assinatura criada com sucesso", assinatura });
    }

    return res
      .status(200)
      .json({ message: "Você ja possui uma assinatura ativa" });
  } catch (error: any) {
    handleError(res, error);
  }
};
