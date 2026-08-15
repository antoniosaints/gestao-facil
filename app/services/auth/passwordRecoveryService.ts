import { sendPasswordResetEmail } from "../email/resendEmailService";
import { env } from "../../utils/dotenv";
import { JwtUtil } from "../../utils/jwt";

export const PASSWORD_RESET_PURPOSE = "pwd_reset";
export const PASSWORD_RESET_TOKEN_TTL = "30m";

export interface PasswordResetUser {
  id: number;
  nome: string;
  email: string;
  tokenVersion: number | null;
}

export async function issuePasswordResetEmail(usuario: PasswordResetUser) {
  const token = JwtUtil.encode(
    {
      id: usuario.id,
      email: usuario.email,
      purpose: PASSWORD_RESET_PURPOSE,
      tv: usuario.tokenVersion,
    },
    PASSWORD_RESET_TOKEN_TTL,
  );
  const resetUrl =
    `${env.BASE_URL_FRONTEND.replace(/\/+$/, "")}/redefinir-senha?token=${encodeURIComponent(token)}`;

  await sendPasswordResetEmail(usuario.email, usuario.nome, resetUrl);
  return { resetUrl };
}
