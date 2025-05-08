import jwt from "jsonwebtoken";
import { env } from "./dotenv";

const JWT_SECRET = env.JWT_SECRET || "chave-secreta-padrão";
const JWT_EXPIRES_IN = "6h";

interface Payload {
  id: number;
  email: string;
  [key: string]: any;
}

export const JwtUtil = {
  /**
   * Gera um token JWT com payload
   */
  encode(payload: Payload): string {
    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
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
