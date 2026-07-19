import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClienteWhatsappMessage,
  normalizeClienteWhatsappPhone,
  resolveClienteWhatsappPhone,
} from "./clienteWhatsappPolicy";

describe("clienteWhatsappPolicy", () => {
  it("normalizes Brazilian customer phone numbers for W-API", () => {
    assert.equal(normalizeClienteWhatsappPhone("(45) 99999-1111"), "5545999991111");
    assert.equal(normalizeClienteWhatsappPhone("5545999991111"), "5545999991111");
    assert.equal(normalizeClienteWhatsappPhone("9999"), "");
  });

  it("prioritizes a manually informed receipt destination without changing the fallback", () => {
    assert.equal(
      resolveClienteWhatsappPhone("(11) 98888-7777", "(45) 99999-1111", null),
      "5511988887777",
    );
    assert.equal(
      resolveClienteWhatsappPhone(undefined, "", "(45) 3333-2222"),
      "554533332222",
    );
  });

  it("builds a payment reminder with formatted amount and payment link", () => {
    const message = buildClienteWhatsappMessage({
      tipo: "COBRANCA",
      clienteNome: "Maria",
      cobrancaUid: "COB_123",
      valor: 149.9,
      vencimento: new Date("2026-06-30T12:00:00.000Z"),
      linkPagamento: "https://pagamento.test/123",
    });

    assert.equal(
      message,
      "Olá, Maria!\nLembrete de cobranca COB_123 no valor de *R$ 149,90 com vencimento em 30/06/2026.\n\nLink para pagamento: https://pagamento.test/123*",
    );
  });

  it("builds free-form, quote and receipt messages", () => {
    assert.equal(
      buildClienteWhatsappMessage({
        tipo: "MENSAGEM",
        clienteNome: "Joao",
        mensagem: "Mensagem personalizada",
      }),
      "Mensagem personalizada",
    );

    assert.equal(
      buildClienteWhatsappMessage({
        tipo: "ORCAMENTO_VENDA",
        clienteNome: "Joao",
        vendaUid: "VEN_321",
        valor: 220,
      }),
      "Olá, Joao!\nSegue o orcamento da venda *VEN_321* no valor de *R$ 220,00*.",
    );

    assert.equal(
      buildClienteWhatsappMessage({
        tipo: "COMPROVANTE_VENDA",
        clienteNome: "Joao",
        vendaUid: "VEN_456",
        valor: 85.5,
        formaPagamento: "PIX",
      }),
      "Olá, Joao!\nSegue o comprovante da venda *VEN_456* no valor de *R$ 85,50.\nForma de pagamento: PIX.*",
    );
  });
});
