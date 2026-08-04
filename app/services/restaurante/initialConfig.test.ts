import assert from "node:assert/strict";
import test from "node:test";
import { buildInitialRestaurantConfig, slugifyRestaurantName } from "./initialConfig";

test("gera slug valido e previsivel a partir do nome da conta", () => {
  assert.equal(slugifyRestaurantName("Pizzaria São João & Filhos"), "pizzaria-sao-joao-filhos");
});

test("preenche a configuracao inicial sem publicar o cardapio", () => {
  assert.deepEqual(buildInitialRestaurantConfig({ id: 12, nome: "Razao Social", nomeFantasia: "Minha Pizza" }), {
    slug: "minha-pizza-12",
    nomePublico: "Minha Pizza",
    ativo: false,
    pedidosQrDireto: false,
    modoFrete: "FIXO",
    taxaFixa: 0,
    freteGratisAcima: null,
    taxaContingencia: null,
    pedidoMinimo: 0,
    retiradaAtiva: true,
    deliveryAtivo: true,
    pagamentoOnlineAtivo: false,
    pagamentoNaEntregaAtivo: true,
  });
});
