import assert from "node:assert/strict";
import test from "node:test";
import { calculateZoneDeliveryFee, normalizeCep, selectDeliveryZone } from "./deliveryZone";

const zones = [
  { id: 1, nome: "Centro", cidade: "São Paulo", bairros: ["Centro"], cepInicial: null, cepFinal: null, taxa: 8, pedidoMinimo: 20, freteGratisAcima: 100, prioridade: 10 },
  { id: 2, nome: "Faixa CEP", cidade: null, bairros: [], cepInicial: "01000000", cepFinal: "01999999", taxa: 12, pedidoMinimo: 30, freteGratisAcima: null, prioridade: 5 },
];

test("normaliza CEP e escolhe a zona de maior prioridade", () => {
  assert.equal(normalizeCep("01001-000"), "01001000");
  assert.equal(selectDeliveryZone(zones, { cep: "01001-000", cidade: "Sao Paulo", bairro: "centro" })?.id, 1);
});

test("usa intervalo de CEP quando bairro nao corresponde", () => {
  assert.equal(selectDeliveryZone(zones, { cep: "01001-000", cidade: "São Paulo", bairro: "Bela Vista" })?.id, 2);
});

test("retorna nulo para endereco sem cobertura", () => {
  assert.equal(selectDeliveryZone(zones, { cep: "90000-000", cidade: "Porto Alegre", bairro: "Centro" }), null);
});

test("aplica frete gratis da zona", () => {
  assert.equal(calculateZoneDeliveryFee(zones[0], 99.99).toNumber(), 8);
  assert.equal(calculateZoneDeliveryFee(zones[0], 100).toNumber(), 0);
});
