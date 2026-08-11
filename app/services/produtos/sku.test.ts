import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gerarSkuUnico } from "./sku";

describe("gerarSkuUnico", () => {
  it("gera o SKU da variante padrão a partir do nome do produto", async () => {
    const client = {
      produto: {
        findFirst: async () => null,
      },
    } as any;

    const sku = await gerarSkuUnico(client, 10, "Hambúrguer artesanal", "Padrão");

    assert.match(sku, /^HAMBUR-[A-Z0-9]{4}$/);
  });

  it("desconsidera a grafia sem acento da variante padrão", async () => {
    const client = {
      produto: {
        findFirst: async () => null,
      },
    } as any;

    const sku = await gerarSkuUnico(client, 10, "Pizza", "Padrao");

    assert.match(sku, /^PIZZA-[A-Z0-9]{4}$/);
  });

  it("tenta novamente quando encontra um SKU já usado na conta", async () => {
    let consultas = 0;
    const client = {
      produto: {
        findFirst: async () => {
          consultas += 1;
          return consultas === 1 ? { id: 1 } : null;
        },
      },
    } as any;

    await gerarSkuUnico(client, 10, "Pizza", "Padrão");

    assert.equal(consultas, 2);
  });
});
