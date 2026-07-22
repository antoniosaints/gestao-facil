import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  avancarDataRecorrencia,
  estaNaJanelaDeGeracao,
  normalizarConfigRecorrencia,
  normalizeFrequenciaRecorrencia,
  podeGerarOcorrencia,
  resolverAlvoPendentes,
} from "./lancamentoRecorrenciaPolicy";

const base = new Date(2026, 6, 21); // 21/07/2026

describe("lancamentoRecorrenciaPolicy", () => {
  it("normaliza a frequência com fallback mensal", () => {
    assert.equal(normalizeFrequenciaRecorrencia("semanal"), "SEMANAL");
    assert.equal(normalizeFrequenciaRecorrencia("TRIMESTRAL"), "TRIMESTRAL");
    assert.equal(normalizeFrequenciaRecorrencia("xpto"), "MENSAL");
    assert.equal(normalizeFrequenciaRecorrencia(null), "MENSAL");
  });

  it("avança a data conforme a frequência", () => {
    assert.deepEqual(avancarDataRecorrencia(base, "DIARIO"), new Date(2026, 6, 22));
    assert.deepEqual(avancarDataRecorrencia(base, "SEMANAL"), new Date(2026, 6, 28));
    assert.deepEqual(avancarDataRecorrencia(base, "QUINZENAL"), new Date(2026, 7, 5));
    assert.deepEqual(avancarDataRecorrencia(base, "MENSAL"), new Date(2026, 7, 21));
    assert.deepEqual(avancarDataRecorrencia(base, "TRIMESTRAL"), new Date(2026, 9, 21));
    assert.deepEqual(avancarDataRecorrencia(base, "SEMESTRAL"), new Date(2027, 0, 21));
    assert.deepEqual(avancarDataRecorrencia(base, "ANUAL"), new Date(2027, 6, 21));
    assert.deepEqual(avancarDataRecorrencia(base, "PERSONALIZADO", 10), new Date(2026, 6, 31));
  });

  it("exige intervalo em dias na frequência personalizada", () => {
    assert.throws(() => avancarDataRecorrencia(base, "PERSONALIZADO"), /dias da recorrência personalizada/);
    assert.throws(
      () => normalizarConfigRecorrencia({ frequencia: "PERSONALIZADO", dataInicio: base }),
      /dias da recorrência personalizada/,
    );
  });

  it("valida a configuração informada pelo usuário", () => {
    const config = normalizarConfigRecorrencia({
      frequencia: "MENSAL",
      dataInicio: base,
      minimoGerado: 3,
      maximoEmAberto: 8,
      geracaoAutomatica: true,
      diasAntecedencia: 15,
    });

    assert.equal(config.minimoGerado, 3);
    assert.equal(config.maximoEmAberto, 8);
    assert.equal(config.diasAntecedencia, 15);
    assert.equal(config.dataFim, null);

    assert.throws(
      () => normalizarConfigRecorrencia({ dataInicio: base, dataFim: new Date(2026, 5, 1) }),
      /posterior à data de início/,
    );
    assert.throws(
      () => normalizarConfigRecorrencia({ dataInicio: base, minimoGerado: 3, maximoEmAberto: 2 }),
      /não pode ser menor que o mínimo/,
    );
    assert.throws(() => normalizarConfigRecorrencia({ dataInicio: null }), /data de início válida/);
  });

  it("usa a data de lançamento como início quando não vier no payload", () => {
    const config = normalizarConfigRecorrencia({}, { dataInicioFallback: base });
    assert.deepEqual(config.dataInicio, base);
    assert.equal(config.minimoGerado, 1);
    assert.equal(config.maximoEmAberto, 6);
  });

  it("resolve o alvo de parcelas em aberto por modo", () => {
    assert.equal(resolverAlvoPendentes({ modo: "MINIMO", minimoGerado: 3, pendentes: 2 }), 3);
    assert.equal(resolverAlvoPendentes({ modo: "MINIMO", minimoGerado: 1, pendentes: 0 }), 1);
    assert.equal(resolverAlvoPendentes({ modo: "PROXIMA", minimoGerado: 1, pendentes: 2 }), 3);
    assert.equal(resolverAlvoPendentes({ modo: "PROXIMA", minimoGerado: 3, pendentes: 1 }), 3);
  });

  it("respeita janela de antecedência da geração automática", () => {
    assert.equal(
      estaNaJanelaDeGeracao({ proximoVencimentoPendente: null, diasAntecedencia: 30, referencia: base }),
      true,
    );
    assert.equal(
      estaNaJanelaDeGeracao({
        proximoVencimentoPendente: new Date(2026, 7, 10),
        diasAntecedencia: 30,
        referencia: base,
      }),
      true,
    );
    assert.equal(
      estaNaJanelaDeGeracao({
        proximoVencimentoPendente: new Date(2026, 8, 10),
        diasAntecedencia: 30,
        referencia: base,
      }),
      false,
    );
  });

  it("bloqueia geração por fim, máximo em aberto e alvo atingido", () => {
    const comum = { ativo: true, pendentes: 1, alvoPendentes: 3, maximoEmAberto: 6, dataFim: null };

    assert.equal(podeGerarOcorrencia({ ...comum, proximoVencimento: base }).permitido, true);
    assert.equal(
      podeGerarOcorrencia({ ...comum, ativo: false, proximoVencimento: base }).motivo,
      "RECORRENCIA_INATIVA",
    );
    assert.equal(podeGerarOcorrencia({ ...comum, proximoVencimento: null }).motivo, "RECORRENCIA_ENCERRADA");
    assert.equal(
      podeGerarOcorrencia({ ...comum, proximoVencimento: base, dataFim: new Date(2026, 5, 30) }).motivo,
      "FIM_ATINGIDO",
    );
    assert.equal(
      podeGerarOcorrencia({ ...comum, proximoVencimento: base, pendentes: 6 }).motivo,
      "MAXIMO_EM_ABERTO",
    );
    assert.equal(
      podeGerarOcorrencia({ ...comum, proximoVencimento: base, pendentes: 3 }).motivo,
      "ALVO_ATINGIDO",
    );
  });
});
