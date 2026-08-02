import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calcularMovimentacoesRealizadasPorConta } from "./saldoContaFinanceiraPolicy";

const referencia = new Date(2026, 7, 2, 0, 0, 0, 0);

describe("calcularMovimentacoesRealizadasPorConta", () => {
  it("usa a mesma regra do resumo financeiro para valor e data de pagamento", () => {
    const resultado = calcularMovimentacoesRealizadasPorConta([
      {
        contaFinanceira: 1,
        valor: "200",
        valorPago: "150",
        pago: true,
        dataPagamento: referencia,
        lancamento: { tipo: "RECEITA", contasFinanceiroId: 1 },
      },
      {
        contaFinanceira: 1,
        valor: "70",
        valorPago: "70",
        pago: true,
        dataPagamento: null,
        lancamento: { tipo: "DESPESA", contasFinanceiroId: 1 },
      },
      {
        contaFinanceira: 1,
        valor: "30",
        valorPago: "30",
        pago: true,
        dataPagamento: new Date(2026, 7, 3),
        lancamento: { tipo: "DESPESA", contasFinanceiroId: 1 },
      },
    ], referencia);

    assert.deepEqual(resultado.get(1), {
      entradasRealizadas: 200,
      saidasRealizadas: 0,
      variacao: 200,
    });
  });

  it("usa a conta do lancamento como fallback sem modificar a parcela existente", () => {
    const resultado = calcularMovimentacoesRealizadasPorConta([
      {
        contaFinanceira: null,
        valor: "200",
        valorPago: null,
        pago: true,
        dataPagamento: referencia,
        lancamento: { tipo: "RECEITA", contasFinanceiroId: 2 },
      },
      {
        contaFinanceira: null,
        valor: "50",
        valorPago: null,
        pago: true,
        dataPagamento: referencia,
        lancamento: { tipo: "DESPESA", contasFinanceiroId: 2 },
      },
    ], referencia);

    assert.deepEqual(resultado.get(2), {
      entradasRealizadas: 200,
      saidasRealizadas: 50,
      variacao: 150,
    });
  });

  it("ignora parcelas pendentes e movimentacoes sem conta identificavel", () => {
    const resultado = calcularMovimentacoesRealizadasPorConta([
      {
        contaFinanceira: 1,
        valor: "200",
        pago: false,
        dataPagamento: referencia,
        lancamento: { tipo: "RECEITA", contasFinanceiroId: 1 },
      },
      {
        contaFinanceira: null,
        valor: "200",
        pago: true,
        dataPagamento: referencia,
        lancamento: { tipo: "RECEITA", contasFinanceiroId: null },
      },
    ], referencia);

    assert.equal(resultado.size, 0);
  });
});
