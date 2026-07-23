import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { handleError } from "../../utils/handleError";
import { env } from "../../utils/dotenv";
import { ResponseHandler } from "../../utils/response";
import {
  createAuthorizationUrl,
  disconnectMercadoPago,
  getMercadoPagoIntegrationStatus,
  handleOAuthCallback,
  isMercadoPagoOAuthEnabled,
  MercadoPagoOAuthError,
} from "../../services/financeiro/mercadoPagoOAuthService";

function redirectToFrontend(res: Response, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return res.redirect(`${env.BASE_URL_FRONTEND}/loja?${query}`);
}

export const iniciarConexaoMercadoPago = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;

    if (!(await hasPermission(customData, 4))) {
      return ResponseHandler(
        res,
        "Apenas administradores podem conectar a conta do Mercado Pago.",
        null,
        403,
      );
    }

    if (!isMercadoPagoOAuthEnabled()) {
      return ResponseHandler(
        res,
        "A conexão automática com o Mercado Pago não está habilitada nesta instalação.",
        null,
        400,
      );
    }

    const url = await createAuthorizationUrl(customData.contaId, customData.userId);

    return ResponseHandler(res, "Link de autorização gerado.", { url });
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};

export const statusIntegracaoMercadoPago = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const status = await getMercadoPagoIntegrationStatus(customData.contaId);

    return ResponseHandler(res, "Status da integração do Mercado Pago.", status);
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};

export const desconectarMercadoPago = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;

    if (!(await hasPermission(customData, 4))) {
      return ResponseHandler(
        res,
        "Apenas administradores podem desconectar a conta do Mercado Pago.",
        null,
        403,
      );
    }

    const removido = await disconnectMercadoPago(customData.contaId);

    return ResponseHandler(
      res,
      removido
        ? "Conta do Mercado Pago desconectada. Remova também a autorização em 'Aplicações autorizadas' na sua conta do Mercado Pago."
        : "Nenhuma conexão do Mercado Pago encontrada para esta conta.",
      await getMercadoPagoIntegrationStatus(customData.contaId),
    );
  } catch (err: any) {
    console.log(err);
    handleError(res, err);
  }
};

/**
 * Rota pública: o Mercado Pago redireciona o navegador do assinante para cá após a
 * autorização, sem Authorization header. A identidade da conta vem do `state`.
 */
export const callbackOAuthMercadoPago = async (
  req: Request,
  res: Response,
): Promise<any> => {
  const { code, state, error } = req.query as Record<string, string | undefined>;

  if (error) {
    return redirectToFrontend(res, { mercadopago: "erro", motivo: error });
  }

  if (!code || !state) {
    return redirectToFrontend(res, { mercadopago: "erro", motivo: "retorno-invalido" });
  }

  try {
    await handleOAuthCallback(code, state);
    return redirectToFrontend(res, { mercadopago: "conectado" });
  } catch (err: any) {
    console.error("Erro no callback OAuth do Mercado Pago:", err);
    const motivo = err instanceof MercadoPagoOAuthError ? err.code : "falha-inesperada";
    return redirectToFrontend(res, { mercadopago: "erro", motivo });
  }
};
