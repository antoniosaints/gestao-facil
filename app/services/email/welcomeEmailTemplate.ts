export interface WelcomeEmailContent {
  subject: string;
  html: string;
  text: string;
}

interface BuildWelcomeEmailInput {
  nome: string;
  conta: string;
  loginUrl: string;
}

export function buildWelcomeEmail({
  nome,
  conta,
  loginUrl,
}: BuildWelcomeEmailInput): WelcomeEmailContent {
  const subject = "Boas-vindas à Gestão Fácil";
  const text =
    `Olá ${nome},\n\n` +
    `A conta ${conta} foi criada com sucesso na Gestão Fácil.\n` +
    `Você já pode acessar o sistema usando o e-mail informado no cadastro:\n\n${loginUrl}\n\n` +
    "Se precisar de ajuda, responda este e-mail para falar com nossa equipe.";

  return {
    subject,
    text,
    html: `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e4e4e7;">
        <p style="margin:0 0 8px;color:#4f46e5;font-size:13px;font-weight:bold;text-transform:uppercase;">
          Seja bem-vindo
        </p>
        <h1 style="margin:0 0 16px;font-size:22px;">Sua conta está pronta</h1>
        <p style="margin:0 0 12px;color:#52525b;font-size:14px;line-height:1.6;">
          Olá <strong>${escapeHtml(nome)}</strong>, a conta
          <strong>${escapeHtml(conta)}</strong> foi criada com sucesso na Gestão Fácil.
        </p>
        <p style="margin:0 0 24px;color:#52525b;font-size:14px;line-height:1.6;">
          Acesse o sistema e entre usando o e-mail informado no cadastro.
        </p>
        <a href="${escapeAttr(loginUrl)}"
           style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;font-size:14px;">
          Acessar a Gestão Fácil
        </a>
        <p style="margin:24px 0 0;color:#a1a1aa;font-size:12px;line-height:1.6;">
          Se o botão não funcionar, copie e cole este endereço no navegador:<br />
          <span style="color:#4f46e5;word-break:break-all;">${escapeHtml(loginUrl)}</span>
        </p>
      </div>
      <p style="text-align:center;color:#a1a1aa;font-size:12px;margin-top:16px;">Gestão Fácil</p>
    </div>
  </body>
</html>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
