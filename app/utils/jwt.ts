import jwt from "jsonwebtoken";
import { env } from "./dotenv";

const JWT_SECRET = env.JWT_SECRET || "chave-secreta-padrão";
const JWT_EXPIRES_IN = "6h";

// Sessão de suporte do superadmin dentro da conta de um assinante.
// Fonte única do TTL: se o expiresIn do JWT e o expiraEm do AcessoSuporteLog
// divergirem, a revogação por expiração fica furada.
export const SUPPORT_TOKEN_TTL_SECONDS = 3600;

export interface SupportClaims {
  imp: true;
  impBy: number;
  impSessao: number;
}

interface Payload {
  id: number;
  email: string;
  [key: string]: any;
}

export const JwtUtil = {
  /**
   * Gera um token JWT com payload
   */
  encode(payload: Payload, expiresIn?: number | any): string {
    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: expiresIn || JWT_EXPIRES_IN,
    });
  },

  /**
   * Verifica se o token é válido
   */
  verify(token: string): Payload | null {
    try {
      return jwt.verify(token, JWT_SECRET) as Payload;
    } catch {
      return null;
    }
  },

  /**
   * Decodifica o token sem verificar assinatura (não seguro)
   */
  decode(token: string): Payload | null {
    try {
      return jwt.decode(token) as Payload;
    } catch {
      return null;
    }
  },
};
