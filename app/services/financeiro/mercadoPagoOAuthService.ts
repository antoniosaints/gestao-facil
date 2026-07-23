import { createHash, randomBytes, randomUUID } from "node:crypto";
import { addSeconds, differenceInMilliseconds, subDays } from "date-fns";
import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";
import { redisConnecion } from "../../utils/redis";
import { decryptSecret, encryptSecret } from "../../utils/secretCrypto";

const AUTHORIZATION_URL = "https://auth.mercadopago.com/authorization";
const TOKEN_URL = "https://api.mercadopago.com/oauth/token";

// O access_token vale 180 dias; renovamos com folga para nunca depender do último dia.
const RENEW_WINDOW_DAYS = 7;
const STATE_TTL_SECONDS = 600;
const REFRESH_LOCK_TTL_SECONDS = 30;

const stateKey = (state: string) => `mp:oauth:state:${state}`;
const refreshLockKey = (contaId: number) => `mp:oauth:refresh:${contaId}`;

export class MercadoPagoOAuthError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "MercadoPagoOAuthError";
  }
}

type MercadoPagoTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number | string;
  token_type?: string;
  scope?: string;
  public_key?: string;
  live_mode?: boolean;
};

type OAuthStatePayload = {
  contaId: number;
  userId: number;
  codeVerifier: string;
};

export type MercadoPagoIntegrationStatus = {
  oauthDisponivel: boolean;
  conectado: boolean;
  modo: "OAUTH" | "API_KEY" | "NENHUM";
  mpUserId: string | null;
  liveMode: boolean | null;
  conectadoEm: Date | null;
  expiraEm: Date | null;
  ultimaRenovacaoEm: Date | null;
  ultimoErro: string | null;
  possuiChaveManual: boolean;
};

export function isMercadoPagoOAuthEnabled(): boolean {
  return Boolean(env.MP_OAUTH_CLIENT_ID && env.MP_OAUTH_CLIENT_SECRET && env.MP_OAUTH_ENC_KEY);
}

export function getRedirectUri(): string {
  return env.MP_OAUTH_REDIRECT_URI || `${env.BASE_URL}/mercadopago/oauth/callback`;
}

function assertEnabled() {
  if (!isMercadoPagoOAuthEnabled()) {
    throw new MercadoPagoOAuthError(
      "A conexão automática com o Mercado Pago não está habilitada nesta instalação.",
      "oauth-desabilitado",
    );
  }
}

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Monta a URL de autorização do Mercado Pago e guarda o state + code_verifier (PKCE)
 * no Redis. O state é de uso único e expira em 10 minutos.
 */
export async function createAuthorizationUrl(contaId: number, userId: number): Promise<string> {
  assertEnabled();

  const state = randomUUID();
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());

  const payload: OAuthStatePayload = { contaId, userId, codeVerifier };
  await redisConnecion.set(stateKey(state), JSON.stringify(payload), "EX", STATE_TTL_SECONDS);

  const params = new URLSearchParams({
    client_id: env.MP_OAUTH_CLIENT_ID as string,
    response_type: "code",
    platform_id: "mp",
    state,
    redirect_uri: getRedirectUri(),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${AUTHORIZATION_URL}?${params.toString()}`;
}

async function consumeState(state: string): Promise<OAuthStatePayload> {
  const results = await redisConnecion.multi().get(stateKey(state)).del(stateKey(state)).exec();
  const raw = results?.[0]?.[1] as string | null | undefined;

  if (!raw) {
    throw new MercadoPagoOAuthError(
      "A autorização expirou ou já foi utilizada. Tente conectar novamente.",
      "state-invalido",
    );
  }

  return JSON.parse(raw) as OAuthStatePayload;
}

async function requestToken(body: Record<string, string>): Promise<MercadoPagoTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: env.MP_OAUTH_CLIENT_ID,
      client_secret: env.MP_OAUTH_CLIENT_SECRET,
      ...body,
    }),
  });

  const data = (await response.json().catch(() => null)) as
    | (MercadoPagoTokenResponse & { message?: string; error?: string })
    | null;

  if (!response.ok || !data?.access_token) {
    const detalhe = data?.message || data?.error || `HTTP ${response.status}`;
    throw new MercadoPagoOAuthError(
      `O Mercado Pago recusou a autorização: ${detalhe}`,
      "token-recusado",
    );
  }

  return data;
}

async function persistTokens(contaId: number, token: MercadoPagoTokenResponse) {
  const expiresAt = addSeconds(new Date(), token.expires_in);
  const dados = {
    mpUserId: String(token.user_id),
    accessTokenEnc: encryptSecret(token.access_token),
    refreshTokenEnc: encryptSecret(token.refresh_token),
    publicKey: token.public_key ?? null,
    scope: token.scope ?? null,
    liveMode: token.live_mode ?? true,
    expiresAt,
    ultimoErro: null,
  };

  return prisma.mercadoPagoOAuthConta.upsert({
    where: { contaId },
    create: { contaId, ...dados },
    update: { ...dados, ultimaRenovacaoEm: new Date() },
  });
}

/**
 * Troca o authorization_code pelo par de tokens e vincula à conta guardada no state.
 * Retorna o contaId para que o callback possa redirecionar/logar corretamente.
 */
export async function handleOAuthCallback(code: string, state: string): Promise<{ contaId: number }> {
  assertEnabled();

  const { contaId, codeVerifier } = await consumeState(state);

  const token = await requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: codeVerifier,
  });

  await persistTokens(contaId, token);

  // Vários fluxos de cobrança carregam ParametrosConta com findUniqueOrThrow. Uma conta
  // que só usa OAuth pode nunca ter salvo parâmetros, então garantimos a linha aqui.
  await prisma.parametrosConta.upsert({
    where: { contaId },
    create: { contaId },
    update: {},
  });

  return { contaId };
}

/**
 * Renova o access_token. O Mercado Pago rotaciona o refresh_token a cada renovação,
 * então o novo par sempre é gravado.
 */
export async function refreshAccessToken(contaId: number): Promise<string> {
  assertEnabled();

  const conexao = await prisma.mercadoPagoOAuthConta.findUnique({ where: { contaId } });
  if (!conexao) {
    throw new MercadoPagoOAuthError(
      "Esta conta não está conectada ao Mercado Pago.",
      "nao-conectado",
    );
  }

  try {
    const token = await requestToken({
      grant_type: "refresh_token",
      refresh_token: decryptSecret(conexao.refreshTokenEnc),
    });
    await persistTokens(contaId, token);
    return token.access_token;
  } catch (error: any) {
    await prisma.mercadoPagoOAuthConta.update({
      where: { contaId },
      data: { ultimoErro: String(error?.message || error).slice(0, 500) },
    });
    throw new MercadoPagoOAuthError(
      "Não foi possível renovar o acesso ao Mercado Pago. Reconecte a conta em Apps > Mercado Pago.",
      "refresh-falhou",
    );
  }
}

/**
 * Access token válido da conta, renovando quando estiver perto de expirar.
 * Retorna null quando a conta não tem conexão OAuth (aí o chamador cai na chave manual).
 */
export async function getValidAccessToken(contaId: number): Promise<string | null> {
  if (!isMercadoPagoOAuthEnabled()) return null;

  const conexao = await prisma.mercadoPagoOAuthConta.findUnique({ where: { contaId } });
  if (!conexao) return null;

  const precisaRenovar = subDays(conexao.expiresAt, RENEW_WINDOW_DAYS) <= new Date();
  if (!precisaRenovar) {
    return decryptSecret(conexao.accessTokenEnc);
  }

  // Lock curto para que requisições e workers concorrentes não gastem o refresh_token
  // em paralelo (o Mercado Pago invalida o anterior a cada renovação).
  const lockAdquirido = await redisConnecion.set(
    refreshLockKey(contaId),
    "1",
    "EX",
    REFRESH_LOCK_TTL_SECONDS,
    "NX",
  );

  if (!lockAdquirido) {
    const expirado = differenceInMilliseconds(conexao.expiresAt, new Date()) <= 0;
    if (!expirado) {
      // Ainda dá para usar o token atual enquanto o outro processo renova.
      return decryptSecret(conexao.accessTokenEnc);
    }
    const atualizado = await prisma.mercadoPagoOAuthConta.findUnique({ where: { contaId } });
    if (atualizado && atualizado.expiresAt > new Date()) {
      return decryptSecret(atualizado.accessTokenEnc);
    }
    throw new MercadoPagoOAuthError(
      "A renovação do acesso ao Mercado Pago está em andamento. Tente novamente em instantes.",
      "refresh-em-andamento",
    );
  }

  try {
    return await refreshAccessToken(contaId);
  } finally {
    await redisConnecion.del(refreshLockKey(contaId));
  }
}

export async function disconnectMercadoPago(contaId: number): Promise<boolean> {
  const removidos = await prisma.mercadoPagoOAuthConta.deleteMany({ where: { contaId } });
  return removidos.count > 0;
}

export async function getMercadoPagoIntegrationStatus(
  contaId: number,
): Promise<MercadoPagoIntegrationStatus> {
  const [conexao, parametros] = await Promise.all([
    isMercadoPagoOAuthEnabled()
      ? prisma.mercadoPagoOAuthConta.findUnique({ where: { contaId } })
      : Promise.resolve(null),
    prisma.parametrosConta.findUnique({
      where: { contaId },
      select: { MercadoPagoApiKey: true },
    }),
  ]);

  const possuiChaveManual = Boolean(parametros?.MercadoPagoApiKey);

  return {
    oauthDisponivel: isMercadoPagoOAuthEnabled(),
    conectado: Boolean(conexao),
    modo: conexao ? "OAUTH" : possuiChaveManual ? "API_KEY" : "NENHUM",
    mpUserId: conexao?.mpUserId ?? null,
    liveMode: conexao?.liveMode ?? null,
    conectadoEm: conexao?.createdAt ?? null,
    expiraEm: conexao?.expiresAt ?? null,
    ultimaRenovacaoEm: conexao?.ultimaRenovacaoEm ?? null,
    ultimoErro: conexao?.ultimoErro ?? null,
    possuiChaveManual,
  };
}
