import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateRestauranteGrupo } from "./catalogPolicy";

describe("validateRestauranteGrupo", () => {
  it("accepts a valid group", () => {
    assert.deepEqual(
      validateRestauranteGrupo({
        minimo: 1,
        maximo: 2,
        opcoes: [
          { nome: "Mussarela", ativo: true },
          { nome: "Calabresa", ativo: true },
        ],
      }),
      [],
    );
  });

  it("rejects incompatible limits and duplicated active options", () => {
    assert.deepEqual(
      validateRestauranteGrupo({
        minimo: 3,
        maximo: 2,
        opcoes: [
          { nome: "Bacon", ativo: true },
          { nome: " bacon ", ativo: true },
        ],
      }),
      [
        "O minimo de escolhas nao pode ser maior que o maximo.",
        "O minimo de escolhas nao pode superar a quantidade de opcoes ativas.",
        "As opcoes ativas do grupo devem ter nomes diferentes.",
      ],
    );
  });

  it("ignores inactive options when checking duplicate names", () => {
    assert.deepEqual(
      validateRestauranteGrupo({
        minimo: 0,
        maximo: 1,
        opcoes: [
          { nome: "Borda", ativo: true },
          { nome: "Borda", ativo: false },
        ],
      }),
      [],
    );
  });
});
