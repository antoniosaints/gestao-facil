import { ParametrosConta } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { MercadoPagoService } from "./mercadoPagoService";
import { getValidAccessToken } from "./mercadoPagoOAuthService";

const MENSAGEM_SEM_CREDENCIAL =
  "Conta do Mercado Pago não conectada. Acesse Apps > Mercado Pago e clique em Conectar.";

type ParametrosCredenciais = Pick<ParametrosConta, "MercadoPagoApiKey"> | null;

async function resolveTenantAccessToken(
  contaId: number,
  parametros?: ParametrosCredenciais,
): Promise<string | null> {
  let oauthError: unknown = null;

  try {
    const accessToken = await getValidAccessToken(contaId);
    if (accessToken) return accessToken;
  } catch (error) {
    // Conexão OAuth existe mas falhou (refresh expirado, por exemplo). Só engolimos o
    // erro se a conta ainda tiver a chave manual antiga para continuar cobrando.
    oauthError = error;
  }

  const credenciais =
    parametros !== undefined
      ? parametros
      : await prisma.parametrosConta.findUnique({
          where: { contaId },
          select: { MercadoPagoApiKey: true },
        });

  if (credenciais?.MercadoPagoApiKey) {
    return credenciais.MercadoPagoApiKey;
  }

  if (oauthError) throw oauthError;

  return null;
}

/**
 * Cliente do Mercado Pago da conta do assinante. A credencial vem da conexão OAuth e,
 * na falta dela, da chave manual legada (ParametrosConta.MercadoPagoApiKey).
 * Não confundir com getSaasMercadoPagoService(), que usa o token do CEO (mensalidades).
 */
export async function getTenantMercadoPagoService(
  contaId: number,
  parametros?: ParametrosCredenciais,
): Promise<MercadoPagoService> {
  const accessToken = await resolveTenantAccessToken(contaId, parametros);

  if (!accessToken) {
    throw new Error(MENSAGEM_SEM_CREDENCIAL);
  }

  return new MercadoPagoService(accessToken);
}

/**
 * Versão tolerante: devolve null em vez de lançar quando a conta não tem credencial
 * (usada em fluxos assíncronos como webhooks, que só devem ignorar o evento).
 */
export async function tryGetTenantMercadoPagoService(
  contaId: number,
  parametros?: ParametrosCredenciais,
): Promise<MercadoPagoService | null> {
  try {
    const accessToken = await resolveTenantAccessToken(contaId, parametros);
    return accessToken ? new MercadoPagoService(accessToken) : null;
  } catch (error) {
    console.warn(`Credencial Mercado Pago indisponível para a conta ${contaId}:`, error);
    return null;
  }
}

export { MENSAGEM_SEM_CREDENCIAL };
