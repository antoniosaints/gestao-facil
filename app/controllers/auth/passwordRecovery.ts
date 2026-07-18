import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";
import { JwtUtil } from "../../utils/jwt";
import { handleError } from "../../utils/handleError";
import { hashPassword } from "../../services/auth/passwordService";
import { sendPasswordResetEmail } from "../../services/email/resendEmailService";

const RESET_PURPOSE = "pwd_reset";
const RESET_TOKEN_TTL = "30m";

// Resposta sempre genérica: não revela se o e-mail existe (anti-enumeração).
const GENERIC_MESSAGE = "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.";

const recuperarSchema = z.object({ email: z.string().email("E-mail inválido") });
const redefinirSchema = z.object({
  token: z.string().min(10, "Token inválido"),
  senha: z.string().min(6, "A senha precisa de ao menos 6 caracteres"),
});

/**
 * Dispara o e-mail de recuperação de senha (casca Resend). Sempre responde a
 * mesma mensagem, exista o e-mail ou não.
 */
export const recuperarSenha = async (req: Request, res: Response): Promise<any> => {
  try {
    const parsed = recuperarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ status: 400, message: "Informe um e-mail válido." });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const usuario = await prisma.usuarios.findFirst({
      where: { email },
      select: { id: true, nome: true, email: true, tokenVersion: true },
    });

    if (usuario) {
      // Token de uso único por design: inclui o tokenVersion; ao redefinir a
      // senha o tokenVersion muda e o link deixa de valer.
      const token = JwtUtil.encode(
        { id: usuario.id, email: usuario.email, purpose: RESET_PURPOSE, tv: usuario.tokenVersion },
        RESET_TOKEN_TTL,
      );
      const resetUrl = `${env.BASE_URL_FRONTEND.replace(/\/+$/, "")}/redefinir-senha?token=${encodeURIComponent(token)}`;

      try {
        await sendPasswordResetEmail(usuario.email, usuario.nome, resetUrl);
      } catch (err) {
        // Não vaza a falha para o cliente; só registra.
        console.error("[recuperarSenha] falha ao enviar e-mail:", err);
      }
    }

    return res.status(200).json({ status: 200, message: GENERIC_MESSAGE });
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * Redefine a senha a partir do token enviado por e-mail.
 */
export const redefinirSenha = async (req: Request, res: Response): Promise<any> => {
  try {
    const parsed = redefinirSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        status: 422,
        message: parsed.error.issues.map((i) => i.message).join(", "),
      });
    }

    const payload = JwtUtil.verify(parsed.data.token);
    if (!payload || payload.purpose !== RESET_PURPOSE) {
      return res.status(400).json({ status: 400, message: "Link inválido ou expirado. Solicite um novo." });
    }

    const usuario = await prisma.usuarios.findUnique({
      where: { id: Number(payload.id) },
      select: { id: true, tokenVersion: true },
    });

    // tokenVersion divergente = link já usado ou senha trocada depois de emitido.
    if (!usuario || (usuario.tokenVersion ?? 0) !== (Number(payload.tv) || 0)) {
      return res.status(400).json({ status: 400, message: "Link inválido ou expirado. Solicite um novo." });
    }

    await prisma.usuarios.update({
      where: { id: usuario.id },
      data: {
        senha: await hashPassword(parsed.data.senha),
        tokenVersion: { increment: 1 },
      },
    });

    return res.status(200).json({ status: 200, message: "Senha redefinida com sucesso. Faça login novamente." });
  } catch (error) {
    handleError(res, error);
  }
};
