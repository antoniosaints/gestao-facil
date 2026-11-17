import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createResendEmailJob,
  createTextEmailJob,
  isResendEmailJobData,
} from "./resendEmailJob";

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

describe("jobs de e-mail legados", () => {
  it("converte texto em um job Resend válido, preservando quebras e escapando HTML", () => {
    const text =
      "Olá <cliente> & equipe\nhttps://example.test/reset?token=abc&mode=test";
    const job = createTextEmailJob({
      to: "qa@example.invalid",
      subject: "Teste",
      text,
    });
    assert.equal(isResendEmailJobData(job), true);
    assert.equal(job.text, text);
    assert.match(job.html, /&lt;cliente&gt; &amp; equipe/);
    assert.ok(
      job.html.includes("\nhttps://example.test/reset?token=abc&amp;mode=test"),
    );
  });
  it("preserva o HTML informado pelo chamador", () => {
    assert.equal(
      createTextEmailJob({
        to: "qa@example.invalid",
        subject: "Teste",
        text: "Olá",
        html: "<p>Olá</p>",
      }).html,
      "<p>Olá</p>",
    );
  });
});
