import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";

import {
  buildComandaPosReceipt,
  buildComandaPdfFilename,
  buildComandaPosFilename,
  calculateComandaTotal,
  calculateComandaPaymentTotal,
  calculateComandaReceiptHeight,
  canChangeComandaItems,
  canDeleteComanda,
  canConfigureComandas,
  canFaturarComanda,
  canFaturarComandaComFinanceiro,
  COMANDA_RECEIPT_80MM_WIDTH_POINTS,
  createComandaUid,
  formatComandaReceiptCurrency,
  getItemSubtotal,
  getProdutoStockDeltaForQuantityEdit,
  resolveComandaPaymentItemIds,
  getStatusAfterPayment,
  requiresStockReturnDecision,
} from "./comandaPolicy";

describe("comandaPolicy", () => {
  it("generates a six-character uppercase alphanumeric public uid", () => {
    const uid = createComandaUid();
    assert.match(uid, /^[A-Z0-9]{6}$/);
  });

  it("calculates item subtotal and comanda total with Decimal precision", () => {
    assert.equal(getItemSubtotal(12.5, 3).toNumber(), 37.5);
    const total = calculateComandaTotal([
      { valorUnitarioSnapshot: new Decimal("10.10"), quantidade: new Decimal("2") },
      { valorUnitarioSnapshot: new Decimal("5.05"), quantidade: new Decimal("3") },
    ]);
    assert.equal(total.toNumber(), 35.35);
  });

  it("allows item changes only while the comanda is open", () => {
    assert.equal(canChangeComandaItems("ABERTA"), true);
    assert.equal(canChangeComandaItems("PENDENTE"), false);
    assert.equal(canChangeComandaItems("FATURADA"), false);
    assert.equal(canChangeComandaItems("CANCELADA"), false);
  });

  it("requires a stock-return decision only for debited product items", () => {
    assert.equal(requiresStockReturnDecision({ origemTipo: "PRODUTO", estoqueDebitado: true }), true);
    assert.equal(requiresStockReturnDecision({ origemTipo: "PRODUTO", estoqueDebitado: false }), false);
    assert.equal(requiresStockReturnDecision({ origemTipo: "SERVICO", estoqueDebitado: false }), false);
    assert.equal(requiresStockReturnDecision({ origemTipo: "AVULSO", estoqueDebitado: false }), false);
  });

  it("calculates product stock delta when editing quantity", () => {
    assert.deepEqual(getProdutoStockDeltaForQuantityEdit(2, 5), { action: "DEBITAR", quantidade: 3 });
    assert.deepEqual(getProdutoStockDeltaForQuantityEdit(5, 2), { action: "REDUZIR", quantidade: 3 });
    assert.deepEqual(getProdutoStockDeltaForQuantityEdit(4, 4), { action: "NENHUM", quantidade: 0 });
  });

  it("maps permission levels for operational and finance actions", () => {
    assert.equal(canFaturarComanda(2), true);
    assert.equal(canFaturarComanda(1), false);
    assert.equal(canFaturarComandaComFinanceiro(3), true);
    assert.equal(canFaturarComandaComFinanceiro(2), false);
    assert.equal(canConfigureComandas(5), true);
    assert.equal(canConfigureComandas(4), false);
    assert.equal(canDeleteComanda(5), true);
    assert.equal(canDeleteComanda(4), true);
    assert.equal(canDeleteComanda(3), false);
  });

  it("builds a stable pdf filename from the public uid", () => {
    assert.equal(buildComandaPdfFilename("A7K2P9"), "comanda-A7K2P9.pdf");
    assert.equal(buildComandaPdfFilename("A7/K2 P9"), "comanda-A7-K2-P9.pdf");
    assert.equal(buildComandaPosFilename("A7/K2 P9"), "comanda-A7-K2-P9-pos.txt");
  });

  it("calculates payment total only for selected unpaid items", () => {
    const items = [
      { id: 1, subtotal: new Decimal(20), pagamentoId: null },
      { id: 2, subtotal: new Decimal("15.50"), pagamentoId: null },
      { id: 3, subtotal: new Decimal(99), pagamentoId: 10 },
    ];

    assert.equal(calculateComandaPaymentTotal(items, [1, 2]).toString(), "35.5");
    assert.throws(
      () => calculateComandaPaymentTotal(items, [3]),
      /Item 3 ja foi faturado/
    );
    assert.throws(
      () => calculateComandaPaymentTotal(items, [999]),
      /Item 999 nao pertence a comanda/
    );
  });

  it("requires explicit selected items before billing", () => {
    assert.deepEqual(resolveComandaPaymentItemIds([2, 1, 2]), [2, 1]);
    assert.throws(
      () => resolveComandaPaymentItemIds(undefined),
      /Selecione ao menos um item para faturar/
    );
    assert.throws(
      () => resolveComandaPaymentItemIds([]),
      /Selecione ao menos um item para faturar/
    );
  });

  it("keeps the comanda pending until every item is paid", () => {
    assert.equal(
      getStatusAfterPayment([
        { id: 1, pagamentoId: 50 },
        { id: 2, pagamentoId: null },
      ]),
      "PENDENTE"
    );
    assert.equal(
      getStatusAfterPayment([
        { id: 1, pagamentoId: 50 },
        { id: 2, pagamentoId: 51 },
      ]),
      "FATURADA"
    );
  });

  it("uses an 80mm receipt width and grows height for long comandas", () => {
    assert.equal(COMANDA_RECEIPT_80MM_WIDTH_POINTS, 226.77);
    assert.equal(calculateComandaReceiptHeight(1, 0), 520);
    assert.equal(calculateComandaReceiptHeight(20, 4), 1102);
  });

  it("formats comanda POS receipt for 80mm ESC/POS printers", () => {
    const receipt = buildComandaPosReceipt(
      {
        nome: "Gestao Facil",
        documento: "12.345.678/0001-90",
        telefone: "(45) 99999-0000",
      },
      {
        Uid: "A7K2P9",
        status: "PENDENTE",
        clienteNomeSnapshot: "Cliente Teste",
        abertura: "2026-06-29T12:30:00.000Z",
        total: new Decimal("35.50"),
        itens: [
          {
            nomeSnapshot: "Produto com acento e nome grande",
            quantidade: new Decimal(2),
            valorUnitarioSnapshot: new Decimal("10"),
            subtotal: new Decimal("20"),
            pagamentoId: 1,
          },
          {
            nomeSnapshot: "Servico",
            quantidade: new Decimal(1),
            valorUnitarioSnapshot: new Decimal("15.50"),
            subtotal: new Decimal("15.50"),
            pagamentoId: null,
          },
        ],
        pagamentos: [
          {
            metodo: "PIX",
            valor: new Decimal("20"),
            dataPagamento: "2026-06-29T12:45:00.000Z",
          },
        ],
      }
    );

    assert.equal(receipt.startsWith("\x1B\x40"), true);
    assert.equal(receipt.endsWith("\x1D\x56\x00"), true);
    assert.match(receipt, /COMPROVANTE DE COMANDA/);
    assert.match(receipt, /Comanda: A7K2P9/);
    assert.match(receipt, /EM ABERTO\s+R\$15,50/);

    const printableLines = receipt
      .split("\n")
      .map((line) => line.replace(/\x1B\x61[\x00-\x02]/g, ""))
      .map((line) => line.replace(/\x1B[@d]\x03?/g, ""))
      .map((line) => line.replace(/\x1D\x56\x00/g, ""))
      .map((line) => line.replace(/[\x00-\x1F\x7F]/g, ""))
      .filter(Boolean);
    assert.equal(printableLines.every((line) => line.length <= 40), true);
  });

  it("formats receipt currency in BRL", () => {
    const formatted = formatComandaReceiptCurrency(new Decimal("12.5"));
    assert.equal(formatted.startsWith("R$"), true);
    assert.match(formatted, /12,50/);
  });
});
