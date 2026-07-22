import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";

import {
  SEM_CATEGORIA,
  agruparPorCategoria,
  calcularParticipacao,
  calcularVariacao,
  getValorReconhecido,
  mapearRaizes,
  montarSerieMensal,
  normalizeRegime,
  parcelaNoPeriodo,
  resolvePeriodoAnterior,
  type ParcelaDemonstrativo,
} from "./demonstrativoPolicy";

function parcela(overrides: Partial<ParcelaDemonstrativo> = {}): ParcelaDemonstrativo {
  return {
    valor: 100,
    valorPago: null,
    vencimento: new Date(2026, 6, 10),
    dataPagamento: null,
    pago: false,
    tipo: "RECEITA",
    categoriaId: null,
    ...overrides,
  };
}

describe("normalizeRegime", () => {
  it("cai para competência em qualquer valor desconhecido", () => {
    assert.equal(normalizeRegime("CAIXA"), "CAIXA");
    assert.equal(normalizeRegime("caixa"), "CAIXA");
    assert.equal(normalizeRegime("xpto"), "COMPETENCIA");
    assert.equal(normalizeRegime(null), "COMPETENCIA");
  });
});

describe("regime de apuração", () => {
  const inicio = new Date(2026, 6, 1);
  const fim = new Date(2026, 6, 31, 23, 59, 59);

  it("na competência usa o vencimento e inclui parcela em aberto", () => {
    const item = parcela({ vencimento: new Date(2026, 6, 15), pago: false })
    assert.equal(parcelaNoPeriodo(item, "COMPETENCIA", inicio, fim), true);
    assert.equal(getValorReconhecido(item, "COMPETENCIA").toNumber(), 100);
  });

  it("no caixa ignora parcela não paga", () => {
    const item = parcela({ vencimento: new Date(2026, 6, 15), pago: false });
    assert.equal(parcelaNoPeriodo(item, "CAIXA", inicio, fim), false);
  });

  it("no caixa usa a data e o valor efetivamente pagos", () => {
    const item = parcela({
      vencimento: new Date(2026, 5, 20),
      pago: true,
      dataPagamento: new Date(2026, 6, 5),
      valorPago: 80,
    });

    // Vence em junho mas foi paga em julho: entra no caixa de julho, não no de junho.
    assert.equal(parcelaNoPeriodo(item, "CAIXA", inicio, fim), true);
    assert.equal(parcelaNoPeriodo(item, "COMPETENCIA", inicio, fim), false);
    assert.equal(getValorReconhecido(item, "CAIXA").toNumber(), 80);
  });

  it("no caixa cai para o valor da parcela quando não há valorPago", () => {
    const item = parcela({ pago: true, dataPagamento: new Date(2026, 6, 5), valorPago: null });
    assert.equal(getValorReconhecido(item, "CAIXA").toNumber(), 100);
  });
});

describe("resolvePeriodoAnterior", () => {
  it("compara mês cheio com o mês anterior inteiro", () => {
    // Julho tem 31 dias e junho 30: contar dias corridos jogaria o início em maio.
    const anterior = resolvePeriodoAnterior(new Date(2026, 6, 1), new Date(2026, 6, 31, 23, 59));

    assert.equal(anterior.inicio.getMonth(), 5);
    assert.equal(anterior.inicio.getDate(), 1);
    assert.equal(anterior.fim.getMonth(), 5);
    assert.equal(anterior.fim.getDate(), 30);
  });

  it("compara trimestre cheio com o trimestre anterior", () => {
    const anterior = resolvePeriodoAnterior(new Date(2026, 6, 1), new Date(2026, 8, 30, 23, 59));

    assert.equal(anterior.inicio.getMonth(), 3);
    assert.equal(anterior.inicio.getDate(), 1);
    assert.equal(anterior.fim.getMonth(), 5);
    assert.equal(anterior.fim.getDate(), 30);
  });

  it("usa a mesma quantidade de dias em recortes quebrados", () => {
    const anterior = resolvePeriodoAnterior(new Date(2026, 6, 5), new Date(2026, 6, 14, 23, 59));

    assert.equal(anterior.inicio.getMonth(), 5);
    assert.equal(anterior.inicio.getDate(), 25);
    assert.equal(anterior.fim.getMonth(), 6);
    assert.equal(anterior.fim.getDate(), 4);
  });
});

describe("mapearRaizes", () => {
  it("resolve a raiz de subcategorias aninhadas", () => {
    const raizes = mapearRaizes([
      { id: 1, nome: "Operacional", parentId: null },
      { id: 2, nome: "Pessoal", parentId: 1 },
      { id: 3, nome: "Encargos", parentId: 2 },
    ]);

    assert.equal(raizes.get(3)?.nome, "Operacional");
    assert.equal(raizes.get(1)?.nome, "Operacional");
  });

  it("não entra em laço infinito com hierarquia circular", () => {
    const raizes = mapearRaizes([
      { id: 1, nome: "A", parentId: 2 },
      { id: 2, nome: "B", parentId: 1 },
    ]);

    assert.ok(raizes.get(1));
    assert.ok(raizes.get(2));
  });
});

describe("calcularVariacao e calcularParticipacao", () => {
  it("calcula a variação percentual entre períodos", () => {
    assert.equal(calcularVariacao(new Decimal(150), new Decimal(100)), 50);
    assert.equal(calcularVariacao(new Decimal(50), new Decimal(100)), -50);
  });

  it("devolve null quando não há base anterior", () => {
    assert.equal(calcularVariacao(new Decimal(150), new Decimal(0)), null);
  });

  it("calcula a participação sobre a base", () => {
    assert.equal(calcularParticipacao(new Decimal(25), new Decimal(200)), 12.5);
    assert.equal(calcularParticipacao(new Decimal(25), new Decimal(0)), 0);
  });

  it("preserva casas suficientes para a tela não arredondar duas vezes", () => {
    // 925 / 7313,94 = 12,6471%. Arredondar aqui para 12,65 fazia a tela exibir
    // 12,7% ao formatar com uma casa.
    const participacao = calcularParticipacao(new Decimal("925"), new Decimal("7313.94"));

    assert.equal(participacao, 12.6471);
    assert.equal(participacao.toFixed(1), "12.6");
  });
});

describe("agruparPorCategoria", () => {
  const categorias = [
    { id: 1, nome: "Serviços", parentId: null },
    { id: 2, nome: "Consultoria", parentId: 1 },
    { id: 3, nome: "Suporte", parentId: 1 },
  ];

  it("agrupa pela raiz, detalha subcategorias e cruza com o período anterior", () => {
    const linhas = agruparPorCategoria(
      [
        { ...parcela({ categoriaId: 2, valor: 300 }), periodo: "ATUAL" },
        { ...parcela({ categoriaId: 3, valor: 200 }), periodo: "ATUAL" },
        { ...parcela({ categoriaId: 2, valor: 250 }), periodo: "ANTERIOR" },
      ],
      categorias,
      "COMPETENCIA",
      "RECEITA",
      new Decimal(500),
    );

    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].nome, "Serviços");
    assert.equal(linhas[0].valor.toNumber(), 500);
    assert.equal(linhas[0].participacao, 100);
    assert.equal(linhas[0].anterior.toNumber(), 250);
    assert.equal(linhas[0].variacao, 100);

    assert.deepEqual(
      linhas[0].subcategorias.map((sub) => [sub.nome, sub.valor.toNumber()]),
      [
        ["Consultoria", 300],
        ["Suporte", 200],
      ],
    );
  });

  it("separa lançamentos sem categoria e ignora o outro tipo", () => {
    const linhas = agruparPorCategoria(
      [
        { ...parcela({ categoriaId: null, valor: 100 }), periodo: "ATUAL" },
        { ...parcela({ categoriaId: 1, valor: 900, tipo: "DESPESA" }), periodo: "ATUAL" },
      ],
      categorias,
      "COMPETENCIA",
      "RECEITA",
      new Decimal(100),
    );

    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].nome, SEM_CATEGORIA);
    assert.equal(linhas[0].categoriaId, null);
    assert.equal(linhas[0].valor.toNumber(), 100);
  });
});

describe("montarSerieMensal", () => {
  it("cria um ponto por mês do período, inclusive sem movimento", () => {
    const serie = montarSerieMensal(
      [
        parcela({ vencimento: new Date(2026, 6, 10), valor: 500 }),
        parcela({ vencimento: new Date(2026, 8, 5), valor: 200, tipo: "DESPESA" }),
      ],
      "COMPETENCIA",
      new Date(2026, 6, 1),
      new Date(2026, 8, 30),
    );

    assert.deepEqual(
      serie.map((ponto) => [ponto.mes, ponto.receitas.toNumber(), ponto.despesas.toNumber(), ponto.resultado.toNumber()]),
      [
        ["2026-07", 500, 0, 500],
        ["2026-08", 0, 0, 0],
        ["2026-09", 0, 200, -200],
      ],
    );
  });
});
