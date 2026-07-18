import axios from "axios";
import { env } from "../../utils/dotenv";

// Casca de envio de e-mails transacionais via Resend (HTTP API — sem SDK extra).
// Se RESEND_API_KEY não estiver configurada, o envio é ignorado (não quebra o
// fluxo), o que mantém a feature opcional em ambientes sem e-mail.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "onboarding@resend.dev";

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

export type SendEmailResult =
  | { sent: true; id?: string }
  | { sent: false; reason: "disabled" };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY) {
    console.warn("[resend] RESEND_API_KEY ausente — e-mail não enviado:", input.subject);
    return { sent: false, reason: "disabled" };
  }

  try {
    const { data } = await axios.post(
      RESEND_ENDPOINT,
      {
        from: input.from ?? env.RESEND_FROM ?? DEFAULT_FROM,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
      },
      {
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );
    return { sent: true, id: data?.id };
  } catch (error: any) {
    // Loga o detalhe do Resend, mas propaga um erro genérico para o chamador.
    console.error("[resend] Falha ao enviar e-mail:", error?.response?.data ?? error?.message);
    throw new Error("Falha ao enviar o e-mail");
  }
}

/**
 * E-mail de recuperação de senha do usuário do ERP.
 */
export async function sendPasswordResetEmail(to: string, nome: string, resetUrl: string) {
  const subject = "Recuperação de senha — Gestão Fácil";
  const text =
    `Olá ${nome},\n\n` +
    `Recebemos um pedido para redefinir a sua senha na Gestão Fácil.\n` +
    `Acesse o link abaixo para criar uma nova senha (válido por 30 minutos):\n\n${resetUrl}\n\n` +
    `Se você não solicitou, ignore este e-mail — sua senha continua a mesma.`;

  return sendEmail({ to, subject, html: passwordResetTemplate(nome, resetUrl), text });
}

function passwordResetTemplate(nome: string, resetUrl: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <div style="max-width:480px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e4e4e7;">
        <h1 style="margin:0 0 8px;font-size:20px;">Recuperação de senha</h1>
        <p style="margin:0 0 20px;color:#52525b;font-size:14px;line-height:1.6;">
          Olá <strong>${escapeHtml(nome)}</strong>, recebemos um pedido para redefinir a sua senha.
          Clique no botão abaixo para criar uma nova. O link expira em <strong>30 minutos</strong>.
        </p>
        <a href="${escapeAttr(resetUrl)}"
           style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;font-size:14px;">
          Redefinir senha
        </a>
        <p style="margin:24px 0 0;color:#a1a1aa;font-size:12px;line-height:1.6;">
          Se você não solicitou, ignore este e-mail — sua senha continua a mesma.<br />
          Se o botão não funcionar, copie e cole este endereço no navegador:<br />
          <span style="color:#4f46e5;word-break:break-all;">${escapeHtml(resetUrl)}</span>
        </p>
      </div>
      <p style="text-align:center;color:#a1a1aa;font-size:12px;margin-top:16px;">Gestão Fácil</p>
    </div>
  </body>
</html>`;
}

// Escapes simples: o nome vem do banco e a URL é montada por nós, mas evitamos
// qualquer quebra de HTML por precaução.
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
