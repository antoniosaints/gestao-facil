import assert from "node:assert/strict";
import test from "node:test";
import { buildWelcomeEmail } from "./welcomeEmailTemplate";

test("monta o e-mail de boas-vindas com os dados da nova conta", () => {
  const email = buildWelcomeEmail({
    nome: "Maria",
    conta: "Loja Central",
    loginUrl: "https://gestaofacil.example/login",
  });

  assert.equal(email.subject, "Boas-vindas à Gestão Fácil");
  assert.match(email.text, /Olá Maria/);
  assert.match(email.text, /Loja Central/);
  assert.match(email.html, /Acessar a Gestão Fácil/);
  assert.match(email.html, /https:\/\/gestaofacil\.example\/login/);
});

test("escapa dados dinâmicos no HTML", () => {
  const email = buildWelcomeEmail({
    nome: '<script>alert("x")</script>',
    conta: "A & B",
    loginUrl: 'https://gestaofacil.example/login?next="inicio"&origin=<email>',
  });

  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /A &amp; B/);
  assert.match(email.html, /&quot;inicio&quot;/);
  assert.match(email.html, /&lt;email&gt;/);
});
