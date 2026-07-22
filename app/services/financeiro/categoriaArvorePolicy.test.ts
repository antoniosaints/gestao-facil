import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  achatarArvoreCategorias,
  alturaDaSubarvore,
  coletarDescendentes,
  montarArvoreCategorias,
  nivelDaCategoria,
  rotuloCompactoCategoria,
  validarMovimentoCategoria,
  type CategoriaFlat,
} from "./categoriaArvorePolicy";

// Custos fixos > Aluguel > Sala 2 ; Custos fixos > Energia ; Vendas
const categorias: CategoriaFlat[] = [
  { id: 1, nome: "Custos fixos", parentId: null },
  { id: 2, nome: "Aluguel", parentId: 1 },
  { id: 3, nome: "Sala 2", parentId: 2 },
  { id: 4, nome: "Energia", parentId: 1 },
  { id: 5, nome: "Vendas", parentId: null },
];

describe("categoriaArvorePolicy", () => {
  it("monta a árvore com nível, caminho e totais", () => {
    const arvore = montarArvoreCategorias(categorias, new Map([[3, 7]]));

    assert.deepEqual(
      arvore.map((node) => node.nome),
      ["Custos fixos", "Vendas"],
    );

    const custos = arvore[0];
    assert.equal(custos.nivel, 0);
    assert.equal(custos.totalDescendentes, 3);
    assert.deepEqual(
      custos.filhos.map((node) => node.nome),
      ["Aluguel", "Energia"],
    );

    const sala = custos.filhos[0].filhos[0];
    assert.equal(sala.nivel, 2);
    assert.equal(sala.caminho, "Custos fixos › Aluguel › Sala 2");
    assert.equal(sala.totalLancamentos, 7);
  });

  it("trata categoria órfã como raiz", () => {
    const arvore = montarArvoreCategorias([
      { id: 10, nome: "Sem pai", parentId: 999 },
      { id: 11, nome: "Raiz", parentId: null },
    ]);

    assert.deepEqual(
      arvore.map((node) => node.nome),
      ["Raiz", "Sem pai"],
    );
  });

  it("não entra em laço infinito com ciclo no banco", () => {
    const arvore = montarArvoreCategorias([
      { id: 1, nome: "A", parentId: 2 },
      { id: 2, nome: "B", parentId: 1 },
      { id: 3, nome: "C", parentId: null },
    ]);

    // A e B formam ciclo e não têm raiz: só C é exibida na raiz.
    assert.deepEqual(
      arvore.map((node) => node.nome),
      ["C"],
    );
  });

  it("gera rótulo curto priorizando a categoria final", () => {
    assert.equal(rotuloCompactoCategoria("Vendas"), "Vendas");
    assert.equal(rotuloCompactoCategoria("Custos fixos › Aluguel"), "Custos fixos › Aluguel");
    assert.equal(rotuloCompactoCategoria("Custos fixos › Aluguel › Sala 2"), "… › Aluguel › Sala 2");
    assert.equal(
      rotuloCompactoCategoria("A › B › C › Sala 2"),
      "… › C › Sala 2",
    );
  });

  it("achata a árvore na ordem de exibição", () => {
    const ordem = achatarArvoreCategorias(montarArvoreCategorias(categorias)).map((node) => node.nome);
    assert.deepEqual(ordem, ["Custos fixos", "Aluguel", "Sala 2", "Energia", "Vendas"]);
  });

  it("calcula descendentes, nível e altura", () => {
    assert.deepEqual([...coletarDescendentes(categorias, 1)].sort(), [2, 3, 4]);
    assert.deepEqual([...coletarDescendentes(categorias, 3)], []);
    assert.equal(nivelDaCategoria(categorias, 3), 2);
    assert.equal(nivelDaCategoria(categorias, 5), 0);
    assert.equal(alturaDaSubarvore(categorias, 1), 2);
    assert.equal(alturaDaSubarvore(categorias, 4), 0);
  });

  it("permite mover para a raiz e para outra árvore", () => {
    assert.equal(validarMovimentoCategoria({ categorias, id: 2, novoPaiId: null }).permitido, true);
    assert.equal(validarMovimentoCategoria({ categorias, id: 2, novoPaiId: 5 }).permitido, true);
  });

  it("bloqueia ciclos", () => {
    const paraSiMesma = validarMovimentoCategoria({ categorias, id: 1, novoPaiId: 1 });
    assert.equal(paraSiMesma.permitido, false);
    assert.equal(paraSiMesma.permitido === false && paraSiMesma.motivo, "CICLO");

    const paraDescendente = validarMovimentoCategoria({ categorias, id: 1, novoPaiId: 3 });
    assert.equal(paraDescendente.permitido, false);
    assert.equal(paraDescendente.permitido === false && paraDescendente.motivo, "CICLO");
  });

  it("bloqueia movimento que estoura a profundidade máxima", () => {
    // Mover "Custos fixos" (altura 2) para dentro de "Sala 2" seria ciclo; aqui
    // usamos uma árvore separada para testar só o limite de profundidade.
    const outras: CategoriaFlat[] = [
      { id: 1, nome: "N1", parentId: null },
      { id: 2, nome: "N2", parentId: 1 },
      { id: 3, nome: "N3", parentId: 2 },
      { id: 4, nome: "Solta", parentId: null },
      { id: 5, nome: "Filha da solta", parentId: 4 },
    ];

    // N3 está no nível 2; receber uma subárvore de altura 1 daria 4 níveis: ok com máximo 5.
    assert.equal(
      validarMovimentoCategoria({ categorias: outras, id: 4, novoPaiId: 3 }).permitido,
      true,
    );

    const estoura = validarMovimentoCategoria({
      categorias: outras,
      id: 4,
      novoPaiId: 3,
      profundidadeMaxima: 3,
    });
    assert.equal(estoura.permitido, false);
    assert.equal(estoura.permitido === false && estoura.motivo, "PROFUNDIDADE");
  });

  it("rejeita categoria ou pai inexistentes", () => {
    const semCategoria = validarMovimentoCategoria({ categorias, id: 99, novoPaiId: null });
    assert.equal(semCategoria.permitido === false && semCategoria.motivo, "CATEGORIA_INEXISTENTE");

    const semPai = validarMovimentoCategoria({ categorias, id: 2, novoPaiId: 99 });
    assert.equal(semPai.permitido === false && semPai.motivo, "PAI_INEXISTENTE");
  });
});
