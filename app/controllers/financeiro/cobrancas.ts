import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { MercadoPagoService } from "../../services/financeiro/mercadoPagoService";
import { generateCobrancaMercadoPago, generateCobrancaMercadoPagoPublico } from "./mercadoPago/gerarCobranca";
import { generateCobrancaAbacatePay } from "./abacatePay/gerarCobranca";
import {
  cancelarCobrancaMercadoPago,
  estornarCobrancaMercadoPago,
} from "./cobrancas/managerCobranca";
import { BodyCobrancaPublicoSchema } from "../../schemas/arena/reservas";
import { handleError } from "../../utils/handleError";
import { sendFinanceiroUpdated } from "../../hooks/financeiro/socket";
import {
  assertOperationalCharge,
  buildOperationalChargeWhere,
} from "../../services/financeiro/chargeVisibilityService";
export interface BodyCobranca {
  type: "PIX" | "BOLETO" | "LINK";
  value: number;
  gateway: "mercadopago" | "abacatepay" | "pagseguro" | "asaas";
  clienteId: number | undefined;
  vinculo?: {
    id: number;
    tipo: "parcela" | "venda" | "os" | "reserva";
  };
}
export const generateCobranca = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    if (!req.body)
      return res
        .status(400)
        .json({ message: "Dados inválidos, informe o corpo da requisição." });
    const { type, value, gateway } = req.body as BodyCobranca;
    if (!type || !value || !gateway)
      return res.status(400).json({
        message:
          "Dados inválidos, informe o tipo de cobrança, o valor e a gateway",
      });

    if (gateway === "mercadopago") {
      const parametros = await prisma.parametrosConta.findFirst({
        where: {
          contaId: customData.contaId,
        },
      });

      if (!parametros)
        return res.status(400).json({
          message:
            "Parametros nao encontrados, informe os parametros da conta para continuar.",
        });

      const resp = await generateCobrancaMercadoPago(req.body, parametros);
      sendFinanceiroUpdated(customData.contaId, { reason: "cobranca-gerada", gateway });
      return res.status(200).json({
        message: resp.paymentLink || "Cobranca gerada com sucesso.",
        data: resp,
      });
    }

    if (gateway === "abacatepay") {
      const resp = await generateCobrancaAbacatePay(req.body, customData.contaId);
      sendFinanceiroUpdated(customData.contaId, { reason: "cobranca-gerada", gateway });
      return res.status(200).json({
        message: resp.paymentLink || "Cobranca gerada com sucesso.",
        data: resp,
      });
    }

    return res.status(200).json({ message: "Cobranca gerada com sucesso." });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};
export const generateCobrancaPublico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { data, success, error } = BodyCobrancaPublicoSchema.safeParse(
      req.body
    );
    if (!success) return handleError(res, error);

    const parametros = await prisma.parametrosConta.findFirst({
      where: {
        contaId: req.body.contaId,
      },
    });

    if (!parametros)
      return res.status(400).json({
        message:
          "Parametros nao encontrados, informe os parametros da conta para continuar.",
      });

    if (data.gateway === "mercadopago") {
      const resp = await generateCobrancaMercadoPagoPublico(req.body, parametros);
      return res.status(200).json({ message: resp });
    }

    return res.status(200).json({ message: "Cobranca gerada com sucesso." });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};
export const getCobrancas = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const cobrancas = await prisma.cobrancasFinanceiras.findMany({
      where: buildOperationalChargeWhere(customData.contaId),
    });
    return res.status(200).json(cobrancas);
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const cancelarCobranca = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { cobrancaId } = req.body;
    if (!cobrancaId)
      return res
        .status(400)
        .json({ message: "Informe o cobrancaId no body da requisição." });
    const customData = getCustomRequest(req).customData;
    const parametros = await prisma.parametrosConta.findUniqueOrThrow({
      where: { contaId: customData.contaId },
    });
    if (!parametros)
      return res.status(400).json({
        message:
          "Parametros nao encontrados, informe os parametros da conta para continuar.",
      });

    const cobranca = await prisma.cobrancasFinanceiras.findUniqueOrThrow({
      where: { id: Number(cobrancaId) },
      include: {
        moduloOnContaAtual: true,
      },
    });

    if (!cobranca)
      return res.status(400).json({ message: "Cobranca nao encontrada." });

    try {
      assertOperationalCharge(cobranca);
    } catch (error: any) {
      return res.status(403).json({ message: error.message });
    }

    if (cobranca.status === "CANCELADO")
      return res.status(400).json({ message: "Cobranca ja cancelada." });

    if (cobranca.gateway === "mercadopago") {
      const resp = await cancelarCobrancaMercadoPago(parametros, cobranca);
      return res.status(200).json({ message: resp });
    }

    return res.status(200).json({
      message: "Nada para cancelar, a cobrança permanece no status atual.",
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};
export const estornarCobranca = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { cobrancaId } = req.body;
    if (!cobrancaId)
      return res
        .status(400)
        .json({ message: "Informe o cobrancaId no body da requisição." });
    const customData = getCustomRequest(req).customData;
    const parametros = await prisma.parametrosConta.findUniqueOrThrow({
      where: { contaId: customData.contaId },
    });
    if (!parametros)
      return res.status(400).json({
        message:
          "Parametros nao encontrados, informe os parametros da conta para continuar.",
      });

    const cobranca = await prisma.cobrancasFinanceiras.findUniqueOrThrow({
      where: { id: Number(cobrancaId) },
      include: {
        moduloOnContaAtual: true,
      },
    });

    if (!cobranca)
      return res.status(400).json({ message: "Cobranca nao encontrada." });

    try {
      assertOperationalCharge(cobranca);
    } catch (error: any) {
      return res.status(403).json({ message: error.message });
    }

    if (cobranca.status === "ESTORNADO")
      return res.status(400).json({ message: "Cobranca ja estornada." });

    if (cobranca.gateway === "mercadopago") {
      const resp = await estornarCobrancaMercadoPago(parametros, cobranca);
      return res.status(200).json({ message: resp });
    }

    return res.status(200).json({
      message: "Nada para estornar, a cobrança permanece no status atual.",
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};
export const deletarCobranca = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.params;
    if (!id)
      return res.status(400).json({ message: "Informe o ID da cobrança." });
    const customData = getCustomRequest(req).customData;
    const cobranca = await prisma.cobrancasFinanceiras.findUniqueOrThrow({
      where: { id: Number(id), contaId: customData.contaId },
      include: {
        moduloOnContaAtual: true,
      },
    });
    if (!cobranca)
      return res.status(400).json({ message: "Cobranca nao encontrada." });
    try {
      assertOperationalCharge(cobranca);
    } catch (error: any) {
      return res.status(403).json({ message: error.message });
    }
    if (!["CANCELADO", "ESTORNADO"].includes(cobranca.status))
      return res
        .status(400)
        .json({
          message:
            "A Cobrança só pode ser deletada no status (CANCELADO, ESTORNADO).",
        });
    await prisma.cobrancasFinanceiras.delete({
      where: { id: cobranca.id, contaId: customData.contaId },
    });
    return res.status(200).json({ message: "Cobranca deletada com sucesso." });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};
export const cancelarMercadoPagoPagamento = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { cobrancaId } = req.body;
    if (!cobrancaId)
      return res
        .status(400)
        .json({ message: "Informe o cobrancaId no body da requisição." });
    const customData = getCustomRequest(req).customData;
    const parametros = await prisma.parametrosConta.findUniqueOrThrow({
      where: { contaId: customData.contaId },
    });
    if (!parametros)
      return res.status(400).json({
        message:
          "Parametros nao encontrados, informe os parametros da conta para continuar.",
      });
    if (!parametros.MercadoPagoApiKey)
      throw new Error(
        "API Key nao encontrada, adicione a chave do Mercado Pago."
      );

    const cobranca = await prisma.cobrancasFinanceiras.findUnique({
      where: { id: Number(cobrancaId), contaId: customData.contaId },
      include: {
        moduloOnContaAtual: true,
      },
    });

    if (cobranca) {
      try {
        assertOperationalCharge(cobranca);
      } catch (error: any) {
        return res.status(403).json({ message: error.message });
      }
    }

    const mp = new MercadoPagoService(parametros.MercadoPagoApiKey);
    const cancelamento = await mp.payment.cancel({
      id: cobrancaId,
    });

    if (cancelamento.status === "cancelled") {
      await prisma.cobrancasFinanceiras.update({
        where: { id: cobrancaId },
        data: { status: "CANCELADO" },
      });
    }

    return res.status(200).json({ message: cancelamento.status });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};
