import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyMensagemTemplate,
  computeDueOffset,
  DEFAULT_LEMBRETE_DIAS,
  getEnabledChannels,
  getOffsetLabel,
  isChannelImplemented,
  normalizeDiasLembrete,
  resolveLembreteSchedule,
  shouldRemindToday,
} from "./inadimplenciaLembretePolicy";

describe("inadimplenciaLembretePolicy", () => {
  describe("normalizeDiasLembrete", () => {
    it("aceita array, remove duplicados/não-inteiros e ordena", () => {
      assert.deepEqual(normalizeDiasLembrete([1, -3, 0, -3, 2.5, "x", -1]), [-3, -1, 0, 1]);
    });

    it("aceita JSON em string", () => {
      assert.deepEqual(normalizeDiasLembrete("[3, 1, 0]"), [0, 1, 3]);
    });

    it("aplica clamp de segurança e ignora fora do intervalo", () => {
      assert.deepEqual(normalizeDiasLembrete([-999, 999, -60, 60, 5]), [-60, 5, 60]);
    });

    it("retorna vazio para entradas inválidas", () => {
      assert.deepEqual(normalizeDiasLembrete(null), []);
      assert.deepEqual(normalizeDiasLembrete("nao-json"), []);
      assert.deepEqual(normalizeDiasLembrete(42), []);
    });
  });

  describe("resolveLembreteSchedule (precedência)", () => {
    it("override ativo vence a config do cliente", () => {
      const resolved = resolveLembreteSchedule({
        override: { ativo: true, diasLembrete: [0, 5], canalWhatsapp: true },
        clienteConfig: { ativo: true, diasLembrete: [-3, -1] },
        legacyFlag: true,
      });
      assert.equal(resolved?.origem, "OVERRIDE_LANCAMENTO");
      assert.deepEqual(resolved?.dias, [0, 5]);
    });

    it("override inativo EXCLUI o lançamento mesmo com cliente ativo", () => {
      const resolved = resolveLembreteSchedule({
        override: { ativo: false, diasLembrete: [0, 5] },
        clienteConfig: { ativo: true, diasLembrete: [-3, -1] },
        legacyFlag: true,
      });
      assert.equal(resolved, null);
    });

    it("usa a config do cliente quando não há override", () => {
      const resolved = resolveLembreteSchedule({
        clienteConfig: { ativo: true, diasLembrete: [-5, 0, 7], canalEmail: true },
        legacyFlag: true,
      });
      assert.equal(resolved?.origem, "CONFIG_CLIENTE");
      assert.deepEqual(resolved?.dias, [-5, 0, 7]);
      assert.deepEqual(resolved?.canais, { whatsapp: true, email: true, sms: false });
    });

    it("cai no padrão legado quando só existe a flag", () => {
      const resolved = resolveLembreteSchedule({ legacyFlag: true });
      assert.equal(resolved?.origem, "LEGADO");
      assert.deepEqual(resolved?.dias, [...DEFAULT_LEMBRETE_DIAS]);
    });

    it("usa os dias padrão da conta no fallback legado quando informados", () => {
      const resolved = resolveLembreteSchedule({ legacyFlag: true, defaultDias: [0, 5, 10] });
      assert.equal(resolved?.origem, "LEGADO");
      assert.deepEqual(resolved?.dias, [0, 5, 10]);
    });

    it("retorna null quando nada está ativo", () => {
      assert.equal(resolveLembreteSchedule({ legacyFlag: false }), null);
      assert.equal(resolveLembreteSchedule({}), null);
      assert.equal(
        resolveLembreteSchedule({ clienteConfig: { ativo: false, diasLembrete: [0] } }),
        null,
      );
    });

    it("config ativa mas sem dias válidos não notifica", () => {
      assert.equal(
        resolveLembreteSchedule({ clienteConfig: { ativo: true, diasLembrete: [] } }),
        null,
      );
    });

    it("garante WhatsApp quando nenhum canal foi marcado", () => {
      const resolved = resolveLembreteSchedule({
        clienteConfig: {
          ativo: true,
          diasLembrete: [0],
          canalWhatsapp: false,
          canalEmail: false,
          canalSms: false,
        },
      });
      assert.deepEqual(resolved?.canais, { whatsapp: true, email: false, sms: false });
    });
  });

  describe("computeDueOffset / shouldRemindToday", () => {
    const vencimento = new Date(2026, 6, 10, 9);

    it("offset negativo antes do vencimento, positivo depois", () => {
      assert.equal(computeDueOffset(vencimento, new Date(2026, 6, 7, 20)), -3);
      assert.equal(computeDueOffset(vencimento, new Date(2026, 6, 10, 1)), 0);
      assert.equal(computeDueOffset(vencimento, new Date(2026, 6, 13, 23)), 3);
    });

    it("dispara apenas nos dias configurados", () => {
      const dias = [-3, 0, 7];
      assert.equal(shouldRemindToday(dias, vencimento, new Date(2026, 6, 7)), true);
      assert.equal(shouldRemindToday(dias, vencimento, new Date(2026, 6, 10)), true);
      assert.equal(shouldRemindToday(dias, vencimento, new Date(2026, 6, 17)), true);
      assert.equal(shouldRemindToday(dias, vencimento, new Date(2026, 6, 8)), false);
    });
  });

  describe("canais", () => {
    it("lista os canais habilitados", () => {
      assert.deepEqual(
        getEnabledChannels({ whatsapp: true, email: false, sms: true }),
        ["WHATSAPP", "SMS"],
      );
    });

    it("só WhatsApp está implementado nesta versão", () => {
      assert.equal(isChannelImplemented("WHATSAPP"), true);
      assert.equal(isChannelImplemented("EMAIL"), false);
      assert.equal(isChannelImplemented("SMS"), false);
    });
  });

  describe("applyMensagemTemplate", () => {
    const vars = {
      cliente: "João",
      descricao: "Mensalidade",
      valor: "R$ 100,00",
      vencimento: "10/07/2026",
      parcela: "2",
    };

    it("substitui placeholders conhecidos (case-insensitive)", () => {
      assert.equal(
        applyMensagemTemplate("Olá {cliente}, a {DESCRICAO} de {valor} vence em {vencimento}.", vars),
        "Olá João, a Mensalidade de R$ 100,00 vence em 10/07/2026.",
      );
    });

    it("mantém placeholders desconhecidos intactos", () => {
      assert.equal(applyMensagemTemplate("{cliente} {foo}", vars), "João {foo}");
    });
  });

  describe("getOffsetLabel", () => {
    it("descreve o marco em português", () => {
      assert.equal(getOffsetLabel(-3), "faltam 3 dias");
      assert.equal(getOffsetLabel(-1), "vence amanhã");
      assert.equal(getOffsetLabel(0), "vence hoje");
      assert.equal(getOffsetLabel(1), "venceu ontem");
      assert.equal(getOffsetLabel(5), "venceu há 5 dias");
    });
  });
});
