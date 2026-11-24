import assert from "node:assert/strict";
import { test } from "node:test";
import { isRetiredEmailJob } from "../email/resendEmailJob";
import { getNotificationEmail, isPushNotificationEnabled, type EmailNotificationEvent } from "./notificationChannelPolicy";
import { isWhatsAppNotificationEventEnabled } from "./whatsappNotificationPolicy";

test("preserva o push das contas existentes e deixa o e-mail operacional desligado", () => {
  assert.equal(isPushNotificationEnabled(null), true);
  assert.equal(isPushNotificationEnabled({ eventoSangria: null }, "SANGRIA"), false);
  assert.equal(isPushNotificationEnabled({ eventoProdutoAlterado: false }, "PRODUTO_ALTERADO"), false);
  assert.equal(getNotificationEmail({ emailAvisos: "avisos@example.test" }, "ESTOQUE_BAIXO"), null);
});

test("desativar um canal preserva as preferências dos demais", () => {
  const preferences = {
    pushNotificacoesAtivo: false,
    emailNotificacoesAtivo: true,
    emailAvisos: " avisos@example.test ",
    whatsappNotificacoesAtivo: true,
    whatsappEventoEstoqueBaixo: true,
  };
  assert.equal(isPushNotificationEnabled(preferences), false);
  assert.equal(isPushNotificationEnabled(preferences, "ESTOQUE_BAIXO"), false);
  assert.equal(getNotificationEmail(preferences, "ESTOQUE_BAIXO"), "avisos@example.test");
  assert.equal(isWhatsAppNotificationEventEnabled(preferences, "ESTOQUE_BAIXO"), true);
  assert.equal(getNotificationEmail({ ...preferences, emailEventoEstoqueBaixo: false }, "ESTOQUE_BAIXO"), null);
  assert.equal(getNotificationEmail({ ...preferences, emailAvisos: "inválido" }, "ESTOQUE_BAIXO"), null);
});

test("os canais respeitam o evento de vencimento e a agenda compartilhada", () => {
  const preferences = {
    financeiroVencimentosNotificacoesAtivo: false,
    pushEventoVencimentoFinanceiro: true,
    emailNotificacoesAtivo: true,
    emailAvisos: "avisos@example.test",
    emailEventoVencimentoFinanceiro: true,
    whatsappNotificacoesAtivo: true,
    whatsappEventoVencimentoFinanceiro: true,
  };
  assert.equal(isPushNotificationEnabled(preferences, "VENCIMENTO_FINANCEIRO"), false);
  assert.equal(getNotificationEmail(preferences, "VENCIMENTO_FINANCEIRO"), null);
  assert.equal(isWhatsAppNotificationEventEnabled(preferences, "VENCIMENTO_FINANCEIRO"), false);
  assert.equal(getNotificationEmail(preferences, "ESTOQUE_BAIXO"), "avisos@example.test");
});

test("descarta o e-mail legado de exclusão e rejeita eventos operacionais não cadastrados", () => {
  assert.equal(isRetiredEmailJob("send", "Produto deletado"), true);
  assert.equal(isRetiredEmailJob("resend", "Redefina sua senha"), false);
  assert.equal(isRetiredEmailJob("loja-cliente", "Redefina sua senha"), false);
  assert.equal(getNotificationEmail(
    { emailNotificacoesAtivo: true, emailAvisos: "avisos@example.test" },
    "PRODUTO_ALTERADO" as EmailNotificationEvent,
  ), null);
});
