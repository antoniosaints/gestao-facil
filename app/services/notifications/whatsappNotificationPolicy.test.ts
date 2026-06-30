import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canConfigureWhatsAppNotifications,
  buildWhatsAppNotificationText,
  getWhatsAppNotificationEventField,
  isWhatsAppNotificationEventEnabled,
  normalizeWhatsAppNotificationPhone,
  selectWhatsAppNotificationRecipients,
} from "./whatsappNotificationPolicy";

describe("whatsappNotificationPolicy", () => {
  it("requires active WhatsApp module and a valid instance only when WhatsApp notifications are enabled", () => {
    assert.equal(
      canConfigureWhatsAppNotifications({
        enabled: false,
        moduleActive: false,
        hasInstance: false,
      }).ok,
      true,
    );

    assert.deepEqual(
      canConfigureWhatsAppNotifications({
        enabled: true,
        moduleActive: false,
        hasInstance: true,
      }),
      {
        ok: false,
        reason: "O modulo de WhatsApp precisa estar ativo para habilitar notificacoes.",
      },
    );

    assert.deepEqual(
      canConfigureWhatsAppNotifications({
        enabled: true,
        moduleActive: true,
        hasInstance: false,
      }),
      {
        ok: false,
        reason: "Selecione uma instancia de WhatsApp para enviar notificacoes.",
      },
    );
  });

  it("maps each supported event to its parameter flag and respects disabled flags", () => {
    assert.equal(getWhatsAppNotificationEventField("NOVA_VENDA"), "whatsappEventoNovaVenda");
    assert.equal(getWhatsAppNotificationEventField("NOVA_OS"), "whatsappEventoNovaOs");
    assert.equal(getWhatsAppNotificationEventField("NOVO_LANCAMENTO"), "whatsappEventoNovoLancamento");
    assert.equal(getWhatsAppNotificationEventField("NOVO_CLIENTE"), "whatsappEventoNovoCliente");
    assert.equal(getWhatsAppNotificationEventField("COMANDA_FATURADA"), "whatsappEventoComandaFaturada");
    assert.equal(getWhatsAppNotificationEventField("CAIXA_ABERTO"), "whatsappEventoCaixaAberto");
    assert.equal(getWhatsAppNotificationEventField("CAIXA_FECHADO"), "whatsappEventoCaixaFechado");
    assert.equal(getWhatsAppNotificationEventField("VENCIMENTO_FINANCEIRO"), "financeiroVencimentosNotificacoesAtivo");

    assert.equal(
      isWhatsAppNotificationEventEnabled(
        {
          whatsappNotificacoesAtivo: true,
          whatsappEventoNovaVenda: false,
        },
        "NOVA_VENDA",
      ),
      false,
    );

    assert.equal(
      isWhatsAppNotificationEventEnabled(
        {
          whatsappNotificacoesAtivo: true,
          whatsappEventoNovaVenda: null,
        },
        "NOVA_VENDA",
      ),
      true,
    );
  });

  it("selects only administrative users with valid phone numbers", () => {
    const recipients = selectWhatsAppNotificationRecipients([
      { id: 1, nome: "Root", permissao: "root", telefone: "(45) 99999-1111", status: "ATIVO" },
      { id: 2, nome: "Admin", permissao: "admin", telefone: "5545999992222", status: "ATIVO" },
      { id: 3, nome: "Gerente", permissao: "gerente", telefone: "45 99999-3333", status: "ATIVO" },
      { id: 4, nome: "Vendedor", permissao: "vendedor", telefone: "45 99999-4444", status: "ATIVO" },
      { id: 5, nome: "Bloqueado", permissao: "admin", telefone: "45 99999-5555", status: "BLOQUEADO" },
      { id: 6, nome: "Sem Telefone", permissao: "admin", telefone: null, status: "ATIVO" },
    ]);

    assert.deepEqual(recipients, [
      { userId: 1, name: "Root", phone: "5545999991111" },
      { userId: 2, name: "Admin", phone: "5545999992222" },
      { userId: 3, name: "Gerente", phone: "5545999993333" },
    ]);
  });

  it("selects only admin and root users for financial due notifications", () => {
    const recipients = selectWhatsAppNotificationRecipients(
      [
        { id: 1, nome: "Root", permissao: "root", telefone: "(45) 99999-1111", status: "ATIVO" },
        { id: 2, nome: "Admin", permissao: "admin", telefone: "5545999992222", status: "ATIVO" },
        { id: 3, nome: "Gerente", permissao: "gerente", telefone: "45 99999-3333", status: "ATIVO" },
      ],
      "VENCIMENTO_FINANCEIRO",
    );

    assert.deepEqual(recipients, [
      { userId: 1, name: "Root", phone: "5545999991111" },
      { userId: 2, name: "Admin", phone: "5545999992222" },
    ]);
  });

  it("normalizes Brazilian WhatsApp numbers and rejects short numbers", () => {
    assert.equal(normalizeWhatsAppNotificationPhone("(45) 99999-1111"), "5545999991111");
    assert.equal(normalizeWhatsAppNotificationPhone("5545999991111"), "5545999991111");
    assert.equal(normalizeWhatsAppNotificationPhone("9999"), "");
  });

  it("builds a concise text message for WhatsApp notifications", () => {
    assert.equal(
      buildWhatsAppNotificationText({
        title: "Nova venda",
        body: "Venda VEN_123 no valor de R$ 100,00.",
      }),
      "*Nova venda*\nVenda VEN_123 no valor de R$ 100,00.",
    );
  });
});
