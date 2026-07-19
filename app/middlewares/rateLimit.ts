import type { Request, Response } from "express";
import { rateLimit, ipKeyGenerator, type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisConnecion } from "../utils/redis";

// Store compartilhado no Redis: com PM2 `-i max` cada worker teria seu próprio
// contador em memória, multiplicando o limite pelo nº de workers. Se a criação
// do store falhar (Redis indisponível), cai para o store em memória do próprio
// express-rate-limit — degrada, mas não derruba o boot.
function makeStore(prefix: string): Store | undefined {
  try {
    return new RedisStore({
      sendCommand: (...args: string[]) =>
        (redisConnecion.call as (...cmd: string[]) => Promise<any>)(...args),
      prefix,
    });
  } catch (error) {
    console.error(`[rateLimit] Falha ao criar RedisStore (${prefix}), usando memória:`, error);
    return undefined;
  }
}

function jsonHandler(message: string) {
  return (_req: Request, res: Response) =>
    res.status(429).json({
      status: 429,
      title: "Muitas requisições",
      message,
    });
}

// Webhooks de gateways chegam de poucos IPs em rajada; um limite por IP os
// bloquearia. Já são autenticados por assinatura/segredo, então ficam de fora.
const WEBHOOK_PREFIXES = ["/asaas/webhook", "/abacatepay/webhook", "/mercadopago/webhook"];

// Proteção anti-flood geral por IP. Teto alto para não atrapalhar uso legítimo.
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("rl:global:"),
  skip: (req: Request) => WEBHOOK_PREFIXES.some((prefix) => req.path.startsWith(prefix)),
  handler: jsonHandler("Você fez muitas requisições em pouco tempo. Aguarde um instante."),
});

// Limite estrito para rotas de autenticação: freia brute-force/credential-stuffing.
// A chave combina IP + e-mail do corpo para não punir uma rede inteira por causa
// de um único alvo, e ao mesmo tempo limitar tentativas contra um e-mail.
const AUTH_WINDOW_MS = 60 * 1000; // 1 minuto
const AUTH_LIMIT = 6;

export const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  limit: AUTH_LIMIT,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("rl:auth:"),
  keyGenerator: (req: Request): string => {
    const ip = ipKeyGenerator(req.ip ?? "");
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return `${ip}|${email}`;
  },
  // Devolve os segundos restantes no corpo (retryAfter) para o front mostrar a
  // contagem sem depender de expor o header Retry-After via CORS.
  handler: (req: Request, res: Response) => {
    const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    const retryAfter = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : Math.ceil(AUTH_WINDOW_MS / 1000);
    return res.status(429).json({
      status: 429,
      title: "Muitas tentativas de login",
      message: `Você atingiu o limite de ${AUTH_LIMIT} tentativas. Aguarde ${retryAfter}s e tente novamente.`,
      retryAfter,
      limit: AUTH_LIMIT,
    });
  },
});
