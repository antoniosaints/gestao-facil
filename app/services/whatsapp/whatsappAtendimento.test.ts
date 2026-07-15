import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calcularDuracaoMs,
  mediaMs,
  montarCiclosAtendimento,
  resolverTransicaoAtendimento,
  type EventoAtendimento,
} from "./whatsappAtendimento";

const t = (iso: string) => new Date(`2026-07-15T${iso}.000Z`);
const ev = (
  conversaId: number,
  tipo: EventoAtendimento["tipo"],
  createdAt: string,
  referenciaEm: string | null = null,
  usuarioId: number | null = 7,
): EventoAtendimento => ({
  conversaId,
  tipo,
  usuarioId,
  referenciaEm: referenciaEm ? t(referenciaEm) : null,
  createdAt: t(createdAt),
});

const agora = new Date("2026-07-15T12:00:00.000Z");
const filaDesde = new Date("2026-07-15T11:58:30.000Z");
const atendidaEm = new Date("2026-07-15T11:59:00.000Z");

const base = { filaDesde: null, atendidaEm: null, agora };

describe("resolverTransicaoAtendimento", () => {
  it("enfileira uma conversa nova quando o cliente manda a primeira mensagem", () => {
    const t = resolverTransicaoAtendimento({ ...base, statusAnterior: null, statusNovo: "PENDENTE" });
    assert.equal(t.evento, "ENFILEIRADA");
    assert.deepEqual(t.filaDesde, agora);
    assert.equal(t.atendidaEm, null);
  });

  it("ao assumir, fecha a espera e começa a contar o atendimento", () => {
    const t = resolverTransicaoAtendimento({
      ...base,
      filaDesde,
      statusAnterior: "PENDENTE",
      statusNovo: "ABERTA",
    });
    assert.equal(t.evento, "ASSUMIDA");
    assert.equal(t.filaDesde, null);
    assert.deepEqual(t.atendidaEm, agora);
    // O evento carrega a entrada na fila, que é o que dá o tempo de espera.
    assert.deepEqual(t.referenciaEm, filaDesde);
  });

  it("ao finalizar, o evento carrega o início do atendimento para medir a resolução", () => {
    const t = resolverTransicaoAtendimento({
      ...base,
      atendidaEm,
      statusAnterior: "ABERTA",
      statusNovo: "FINALIZADA",
    });
    assert.equal(t.evento, "FINALIZADA");
    assert.deepEqual(t.referenciaEm, atendidaEm);
    assert.equal(t.filaDesde, null);
    assert.equal(t.atendidaEm, null);
  });

  // O caso que motivou o log append-only: a conversa é uma thread rolante, então um cliente
  // recorrente reabre a mesma linha. A finalização anterior não pode sumir do histórico.
  it("reenfileira uma conversa finalizada que recebe nova mensagem", () => {
    const t = resolverTransicaoAtendimento({ ...base, statusAnterior: "FINALIZADA", statusNovo: "PENDENTE" });
    assert.equal(t.evento, "ENFILEIRADA");
    assert.deepEqual(t.filaDesde, agora);
  });

  // Sem isso, cada mensagem recebida numa conversa já em espera geraria um novo ENFILEIRADA,
  // reiniciando o relógio da fila e inflando a contagem de eventos.
  it("não gera evento nem mexe na conversa quando o status não muda de fase", () => {
    for (const status of ["PENDENTE", "ABERTA", "FINALIZADA"] as const) {
      const t = resolverTransicaoAtendimento({ ...base, filaDesde, statusAnterior: status, statusNovo: status });
      assert.equal(t.evento, null, `status ${status} não deveria gerar evento`);
      assert.equal(t.filaDesde, undefined, `status ${status} não deveria mexer em filaDesde`);
      assert.equal(t.atendidaEm, undefined, `status ${status} não deveria mexer em atendidaEm`);
    }
  });

  // Conversa iniciada pelo atendente nunca passou por uma fila: sem referência, a espera dela
  // não entra na média (em vez de entrar como zero).
  it("assume sem referência quando a conversa não passou pela fila", () => {
    const t = resolverTransicaoAtendimento({ ...base, statusAnterior: null, statusNovo: "ABERTA" });
    assert.equal(t.evento, "ASSUMIDA");
    assert.equal(t.referenciaEm, null);
  });
});

describe("montarCiclosAtendimento", () => {
  it("monta um ciclo completo com espera e duração", () => {
    const [ciclo] = montarCiclosAtendimento([
      ev(1, "ENFILEIRADA", "12:00:00"),
      ev(1, "ASSUMIDA", "12:05:00", "12:00:00"),
      ev(1, "FINALIZADA", "12:20:00", "12:05:00"),
    ]);
    assert.equal(ciclo.status, "FINALIZADO");
    assert.equal(ciclo.atendenteId, 7);
    assert.equal(ciclo.esperaMs, 5 * 60_000);
    assert.equal(ciclo.duracaoMs, 15 * 60_000);
  });

  // O motivo de existir o log: um cliente recorrente reabre a MESMA conversa, então a thread
  // tem vários ciclos. Agregar por conversa perderia todos menos o último.
  it("separa vários ciclos da mesma conversa", () => {
    const ciclos = montarCiclosAtendimento([
      ev(1, "ENFILEIRADA", "09:00:00"),
      ev(1, "ASSUMIDA", "09:01:00", "09:00:00"),
      ev(1, "FINALIZADA", "09:10:00", "09:01:00"),
      ev(1, "ENFILEIRADA", "15:00:00"),
      ev(1, "ASSUMIDA", "15:02:00", "15:00:00"),
      ev(1, "FINALIZADA", "15:30:00", "15:02:00"),
    ]);
    assert.equal(ciclos.length, 2);
    assert.equal(ciclos[0].duracaoMs, 9 * 60_000);
    assert.equal(ciclos[1].duracaoMs, 28 * 60_000);
    assert.equal(ciclos[1].esperaMs, 2 * 60_000);
  });

  // Ciclo que começou antes da janela consultada: só o FINALIZADA aparece. Melhor reportar a
  // duração e assumir espera desconhecida do que fingir zero.
  it("recupera ciclo iniciado fora da janela, sem inventar espera", () => {
    const [ciclo] = montarCiclosAtendimento([ev(1, "FINALIZADA", "12:20:00", "12:05:00")]);
    assert.equal(ciclo.status, "FINALIZADO");
    assert.deepEqual(ciclo.assumidoEm, t("12:05:00"));
    assert.equal(ciclo.duracaoMs, 15 * 60_000);
    assert.equal(ciclo.esperaMs, null);
    assert.equal(ciclo.entrouFilaEm, null);
  });

  it("reporta ciclo ainda em andamento e ciclo ainda na fila", () => {
    const ciclos = montarCiclosAtendimento([
      ev(1, "ENFILEIRADA", "12:00:00"),
      ev(1, "ASSUMIDA", "12:05:00", "12:00:00"),
      ev(2, "ENFILEIRADA", "12:10:00"),
    ]);
    assert.equal(ciclos.length, 2);
    assert.equal(ciclos[0].status, "EM_ANDAMENTO");
    assert.equal(ciclos[0].finalizadoEm, null);
    assert.equal(ciclos[1].status, "NA_FILA");
    assert.equal(ciclos[1].assumidoEm, null);
  });

  // Cliente volta a falar antes de alguém encerrar: o ciclo anterior não some do relatório.
  it("fecha ciclo abandonado quando a conversa é reenfileirada", () => {
    const ciclos = montarCiclosAtendimento([
      ev(1, "ENFILEIRADA", "12:00:00"),
      ev(1, "ASSUMIDA", "12:05:00", "12:00:00"),
      ev(1, "ENFILEIRADA", "12:30:00"),
      ev(1, "ASSUMIDA", "12:31:00", "12:30:00"),
      ev(1, "FINALIZADA", "12:40:00", "12:31:00"),
    ]);
    assert.equal(ciclos.length, 2);
    assert.equal(ciclos[0].status, "EM_ANDAMENTO");
    assert.equal(ciclos[1].status, "FINALIZADO");
  });

  it("não mistura ciclos de conversas diferentes mesmo fora de ordem", () => {
    const ciclos = montarCiclosAtendimento([
      ev(2, "FINALIZADA", "12:40:00", "12:31:00", 9),
      ev(1, "ENFILEIRADA", "12:00:00"),
      ev(2, "ASSUMIDA", "12:31:00", "12:30:00", 9),
      ev(1, "ASSUMIDA", "12:05:00", "12:00:00", 7),
      ev(1, "FINALIZADA", "12:20:00", "12:05:00", 7),
    ]);
    assert.equal(ciclos.length, 2);
    assert.equal(ciclos[0].conversaId, 1);
    assert.equal(ciclos[0].atendenteId, 7);
    assert.equal(ciclos[1].conversaId, 2);
    assert.equal(ciclos[1].atendenteId, 9);
  });
});

describe("mediaMs", () => {
  it("ignora amostras desconhecidas em vez de contá-las como zero", () => {
    assert.equal(mediaMs([100, null, 300]), 200);
  });

  it("devolve null quando não há amostra", () => {
    assert.equal(mediaMs([]), null);
    assert.equal(mediaMs([null, null]), null);
  });
});

describe("calcularDuracaoMs", () => {
  it("mede o intervalo fechado pelo evento", () => {
    assert.equal(calcularDuracaoMs(filaDesde, agora), 90_000);
  });

  it("ignora eventos sem referência", () => {
    assert.equal(calcularDuracaoMs(null, agora), null);
    assert.equal(calcularDuracaoMs(undefined, agora), null);
  });

  it("descarta duração negativa em vez de poluir a média", () => {
    assert.equal(calcularDuracaoMs(new Date("2026-07-15T12:00:10.000Z"), agora), null);
  });
});
