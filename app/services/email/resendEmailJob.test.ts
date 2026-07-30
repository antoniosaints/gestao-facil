import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createResendEmailJob, isResendEmailJobData } from "./resendEmailJob";

describe("resendEmailJob", () => {
  it("cria um job completo para processamento assíncrono", () => {
    const job = createResendEmailJob({
      to: "cliente@example.com",
      subject: "Bem-vindo",
      html: "<p>Olá</p>",
      text: "Olá",
    });

    assert.deepEqual(job, {
      provider: "resend",
      to: "cliente@example.com",
      subject: "Bem-vindo",
      html: "<p>Olá</p>",
      text: "Olá",
    });
    assert.equal(isResendEmailJobData(job), true);
  });

  it("copia a lista de destinatários para não permitir mutação posterior", () => {
    const recipients = ["a@example.com", "b@example.com"];
    const job = createResendEmailJob({
      to: recipients,
      subject: "Aviso",
      html: "<p>Aviso</p>",
    });

    recipients.push("c@example.com");

    assert.deepEqual(job.to, ["a@example.com", "b@example.com"]);
  });

  it("rejeita payloads legados ou incompletos", () => {
    assert.equal(
      isResendEmailJobData({
        to: "cliente@example.com",
        subject: "Legado",
        text: "Sem HTML e provider",
      }),
      false,
    );
    assert.equal(
      isResendEmailJobData({
        provider: "resend",
        to: [],
        subject: "Sem destinatário",
        html: "<p>Teste</p>",
      }),
      false,
    );
  });
});
