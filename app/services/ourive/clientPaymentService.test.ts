import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MetodoPagamento } from "../../../generated/client";
import { clientPaymentSchema } from "./clientPaymentSchema";
import { saveClientPayment } from "./clientPaymentService";

describe("Pagamento do cliente da ourivesaria", () => {
  it("aceita todos os métodos padrão e preserva centavos", () => {
    for (const method of Object.values(MetodoPagamento)) {
      assert.deepEqual(
        clientPaymentSchema.parse({
          antecipacaoCliente: 1075.25,
          formaPagamentoCliente: method,
        }),
        { antecipacaoCliente: 1075.25, formaPagamentoCliente: method },
      );
    }
  });

  it("permite uma OS sem antecipação nem forma de pagamento", () => {
    assert.equal(
      clientPaymentSchema.safeParse({
        antecipacaoCliente: 0,
        formaPagamentoCliente: null,
      }).success,
      true,
    );
  });

  it("recusa antecipação sem método, método inválido e valores inválidos", () => {
    for (const payment of [
      { antecipacaoCliente: 10, formaPagamentoCliente: null },
      { antecipacaoCliente: 10, formaPagamentoCliente: "INVALIDO" },
      { antecipacaoCliente: -1, formaPagamentoCliente: "PIX" },
      { antecipacaoCliente: Infinity, formaPagamentoCliente: "PIX" },
      { antecipacaoCliente: 100_000_000, formaPagamentoCliente: "PIX" },
      { antecipacaoCliente: "1.075,00", formaPagamentoCliente: "PIX" },
    ])
      assert.equal(clientPaymentSchema.safeParse(payment).success, false);
  });

  function database(order: any, count = 1) {
    const calls: { find?: any; update?: any; event?: any } = {};
    const tx = {
      ouriveOrdem: {
        findFirst: async (query: any) => {
          calls.find = query;
          return order;
        },
        updateMany: async (query: any) => {
          calls.update = query;
          return { count };
        },
      },
      ouriveEvento: {
        create: async (query: any) => {
          calls.event = query;
        },
      },
    };
    return { calls, db: { $transaction: async (fn: any) => fn(tx) } };
  }

  const actor = { contaId: 7, userId: 3 };
  const payment = {
    antecipacaoCliente: 1075.25,
    formaPagamentoCliente: MetodoPagamento.PIX,
  };

  it("registra um pagamento após a criação, com histórico e bloqueio de faturamento", async () => {
    const { db, calls } = database({ id: 42, antecipacaoCliente: 0 });
    assert.equal(await saveClientPayment(db, actor, 42, payment), "updated");
    assert.deepEqual(calls.find.where, { id: 42, contaId: 7 });
    assert.deepEqual(calls.update.where, {
      id: 42,
      contaId: 7,
      faturadaEm: null,
    });
    assert.equal(calls.update.data.antecipacaoCliente.toFixed(2), "1075.25");
    assert.equal(calls.update.data.formaPagamentoCliente, "PIX");
    assert.deepEqual(calls.event.data.dados, {
      antecipacaoClienteAnterior: "0.00",
      antecipacaoCliente: "1075.25",
      formaPagamentoClienteAnterior: null,
      formaPagamentoCliente: "PIX",
    });
    assert.equal(calls.event.data.autorId, 3);
  });

  it("substitui o total já pago sem duplicá-lo ao salvar novamente", async () => {
    const { db, calls } = database({
      id: 42,
      antecipacaoCliente: 1000,
      formaPagamentoCliente: "DINHEIRO",
    });
    await saveClientPayment(db, actor, 42, payment);
    assert.equal(calls.update.data.antecipacaoCliente.toFixed(2), "1075.25");
    assert.equal(calls.event.data.dados.antecipacaoClienteAnterior, "1000.00");
    assert.equal(
      calls.event.data.dados.formaPagamentoClienteAnterior,
      "DINHEIRO",
    );
  });

  it("não altera uma ordem inexistente ou de outra conta", async () => {
    const { db, calls } = database(null);
    assert.equal(
      await saveClientPayment(db, actor, 42, payment),
      "order_not_found",
    );
    assert.deepEqual(calls.find.where, { id: 42, contaId: 7 });
    assert.equal(calls.update, undefined);
    assert.equal(calls.event, undefined);
  });

  it("não registra evento quando a OS já foi faturada, inclusive durante a atualização", async () => {
    const { db, calls } = database({ id: 42, antecipacaoCliente: 0 }, 0);
    assert.equal(
      await saveClientPayment(db, actor, 42, payment),
      "order_billed",
    );
    assert.equal(calls.event, undefined);
  });
});
