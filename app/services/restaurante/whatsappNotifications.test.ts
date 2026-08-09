import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRestaurantWhatsAppTemplateValues,
  formatRestaurantOrderItems,
  restaurantPaymentMethodLabel,
} from "./whatsappNotificationTemplate";

test("formata itens, sabores e complementos para a mensagem do pedido", () => {
  assert.equal(formatRestaurantOrderItems([{
    quantidade: 1,
    nomeSnapshot: "Pizza Grande",
    tamanhoSnapshot: "Grande",
    selecoesSnapshotJson: [
      { tipo: "SABOR", nome: "Calabresa" },
      { tipo: "COMPLEMENTO", nome: "Borda recheada" },
    ],
  }]), "➡️ 1x Pizza Grande\n   Grande\n   Sabor: Calabresa\n   Complemento: Borda recheada");
});

test("monta as variáveis comerciais do pedido sem expor dados além do endereço", () => {
  const values = buildRestaurantWhatsAppTemplateValues({
    id: 61,
    codigo: "RSL4Q8N43531",
    clienteNomeSnapshot: "Antonio Costa dos Santos",
    empresa: "Pizzaria Central",
    total: "57.99",
    frete: "7.00",
    origem: "DELIVERY",
    enderecoSnapshotJson: {
      logradouro: "Rua do sol",
      numero: "283",
      complemento: "Casa",
      bairro: "Centro",
      cidade: "São Mateus do Maranhão",
    },
    pagamentoMetodoSnapshot: "PIX",
    itens: [{ quantidade: 1, nomeSnapshot: "Pizza Grande", selecoesSnapshotJson: [{ tipo: "SABOR", nome: "Calabresa" }] }],
  });

  assert.equal(values.primeiroNome, "Antonio");
  assert.equal(values.nomeAbreviado, "Antonio");
  assert.equal(values.idPedido, "RSL4Q8N43531");
  assert.equal(values.numeroPedido, "61");
  assert.equal(values.endereco, "Rua do sol, Nº 283 - Casa, Centro, São Mateus do Maranhão");
  assert.equal(values.pagamento, "📱 Pix");
  assert.equal(values.entrega, "🛵 Delivery (taxa de: R$ 7,00)");
  assert.equal(values.total, "R$ 57,99");
});

test("traduz métodos de pagamento conhecidos e mantém fallback seguro", () => {
  assert.equal(restaurantPaymentMethodLabel("NA_ENTREGA"), "💵 Pagamento na entrega");
  assert.equal(restaurantPaymentMethodLabel("INEXISTENTE"), "Pagamento a combinar");
});
