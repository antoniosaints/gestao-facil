import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMercadoPagoChargeReference,
  buildMercadoPagoLinkChargeData,
  buildMercadoPagoOperationalWebhookUrl,
  parseMercadoPagoChargeReference,
} from "./mercadoPagoChargeReference";

test("preserva conta, cobrança e origem no link Mercado Pago", () => {
  const reference = {
    contaId: 42,
    chargeUid: "COB_ABC123",
    kind: "link" as const,
    origin: { type: "venda" as const, id: 91 },
  };

  const encoded = buildMercadoPagoChargeReference(reference);

  assert.equal(encoded, "conta:42|cobranca:COB_ABC123|tipo:link|origem:venda|entidade:91");
  assert.deepEqual(parseMercadoPagoChargeReference(encoded), reference);
});

test("mantém compatibilidade com referências antigas de PIX e boleto", () => {
  assert.deepEqual(
    parseMercadoPagoChargeReference("conta:7|cobranca:COB_1|pix"),
    { contaId: 7, chargeUid: "COB_1", kind: "pix" },
  );
  assert.deepEqual(
    parseMercadoPagoChargeReference("conta:7|cobranca:COB_2|boleto"),
    { contaId: 7, chargeUid: "COB_2", kind: "boleto" },
  );
});

test("gera URL de webhook com parâmetros de roteamento da origem", () => {
  const url = new URL(
    buildMercadoPagoOperationalWebhookUrl("https://api.example.com/base", {
      contaId: 3,
      chargeUid: "COB_9",
      kind: "link",
      origin: { type: "os", id: 15 },
    }),
  );

  assert.equal(url.pathname, "/mercadopago/webhook/cobrancas");
  assert.equal(url.searchParams.get("contaId"), "3");
  assert.equal(url.searchParams.get("escopo"), "operacional");
  assert.equal(url.searchParams.get("tipo"), "link");
  assert.equal(url.searchParams.get("cobrancaUid"), "COB_9");
  assert.equal(url.searchParams.get("origemTipo"), "os");
  assert.equal(url.searchParams.get("origemId"), "15");
});

test("rejeita referências incompletas ou com origem inválida", () => {
  assert.equal(parseMercadoPagoChargeReference("conta:3|tipo:link"), null);
  assert.equal(
    parseMercadoPagoChargeReference("conta:3|cobranca:COB_1|tipo:link|origem:venda"),
    null,
  );
  assert.equal(
    parseMercadoPagoChargeReference(
      "conta:3|cobranca:COB_1|tipo:link|origem:desconhecida|entidade:1",
    ),
    null,
  );
});

test("cria os dados locais com payment.id e vínculo da entidade, nunca com preference.id", () => {
  const data = buildMercadoPagoLinkChargeData(
    987654,
    {
      transaction_amount: 150.5,
      payment_type_id: "credit_card",
      date_of_expiration: "2026-08-01T12:00:00.000Z",
    },
    {
      contaId: 8,
      chargeUid: "COB_LINK1",
      kind: "link",
      origin: { type: "parcela", id: 77 },
    },
  );

  assert.equal(data.idCobranca, "987654");
  assert.equal(data.contaId, 8);
  assert.equal(data.lancamentoId, 77);
  assert.equal(data.vendaId, null);
  assert.equal(data.valor, 150.5);
});

test("preserva o vínculo próprio da reserva geral sem reutilizar a reserva da Arena", () => {
  const reference = {
    contaId: 12,
    chargeUid: "COB_RESERVA",
    kind: "link" as const,
    origin: { type: "reserva-geral" as const, id: 345 },
  };
  const parsed = parseMercadoPagoChargeReference(buildMercadoPagoChargeReference(reference));
  assert.deepEqual(parsed, reference);

  const data = buildMercadoPagoLinkChargeData(
    999,
    { transaction_amount: 80, payment_type_id: "bank_transfer" },
    reference,
  );
  assert.equal(data.reservaGeralId, 345);
  assert.equal(data.reservaId, null);
  assert.equal(data.contaId, 12);
});

test("preserva o vinculo do pedido de restaurante no Checkout Pro", () => {
  const reference = {
    contaId: 21,
    chargeUid: "COB_RESTAURANTE",
    kind: "link" as const,
    origin: { type: "restaurante-pedido" as const, id: 456 },
  };
  assert.deepEqual(
    parseMercadoPagoChargeReference(buildMercadoPagoChargeReference(reference)),
    reference,
  );
  const data = buildMercadoPagoLinkChargeData(
    1234,
    { transaction_amount: 95, payment_type_id: "credit_card" },
    reference,
  );
  assert.equal(data.restaurantePedidoId, 456);
  assert.equal(data.contaId, 21);
});
