import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";

import { getDashboardFinanceiroVisaoGeral } from "../../controllers/financeiro/dashboard";
import { calcularSaldosAtuaisContas } from "../../services/financeiro/saldoContaFinanceiraService";
import { prisma } from "../../utils/prisma";

const data = new Date(2025, 6, 15);
const contas = [
  { id: 1, nome: "Conta principal", saldoInicial: 100, ignorarNosCalculos: false },
  { id: 2, nome: "Conta reserva", saldoInicial: 1000, ignorarNosCalculos: true },
];

function parcela(id: number, contaFinanceira: number | null, contasFinanceiroId: number | null,
  tipo: "RECEITA" | "DESPESA", valor: number, pago: boolean) {
  return {
    id, numero: 1, contaFinanceira, valor, pago, ignorado: false, vencimento: data,
    dataPagamento: pago ? data : null, formaPagamento: null, CobrancasFinanceiras: [],
    lancamento: {
      id, Uid: String(id), descricao: "Teste", tipo, ignorado: false, contasFinanceiroId,
      categoria: { id: 1, nome: "Categoria" }, cliente: null, _count: { parcelas: 1 },
    },
  };
}

const parcelas = [
  parcela(1, 1, 2, "RECEITA", 50, true),
  parcela(2, 2, 1, "DESPESA", 70, true),
  parcela(3, null, 2, "RECEITA", 300, false),
  parcela(4, null, 1, "DESPESA", 20, true),
  parcela(5, null, null, "RECEITA", 10, false),
];

async function consultar(controller: (req: Request, res: Response) => Promise<unknown>, query: Record<string, string>) {
  let resposta: any;
  const req = { query, customData: { contaId: 9 } } as unknown as Request;
  const res = {
    json: (body: unknown) => { resposta = body; },
    status: (status: number) => { assert.equal(status, 200); return res; },
  } as unknown as Response;
  await controller(req, res);
  assert.ok(resposta?.data);
  return resposta.data;
}

test("conta ignorada preserva o saldo próprio e sai dos totais, fluxo e gráficos até ser reativada", async () => {
  let ignorarReserva = true;
  prisma.$use(async ({ model, action, args }) => {
    assert.equal(action, "findMany");
    switch (model) {
      case "ContasFinanceiro":
        return contas.map((conta) => ({ ...conta, ignorarNosCalculos: conta.id === 2 && ignorarReserva }));
      case "ParcelaFinanceiro":
        return parcelas;
      case "AssinaturaPagar":
        assert.deepEqual(args.where.AND, [{
          OR: [
            { contaFinanceiraId: null },
            { contaFinanceira: { is: { ignorarNosCalculos: false } } },
          ],
        }]);
        return [];
      default:
        assert.fail(model);
    }
  });

  const query = {
    inicio: new Date(2025, 6, 1).toISOString(),
    fim: new Date(2025, 6, 31).toISOString(),
  };
  const painel = await consultar(getDashboardFinanceiroVisaoGeral, query);
  assert.equal(painel.cards.saldoAtual, 130);
  assert.equal(painel.cards.saldoPrevisto, 140);
  assert.equal(painel.cards.receitasPrevistas, 60);
  assert.equal(painel.cards.despesasPrevistas, 20);
  assert.deepEqual(painel.graficos.fluxo.datasets.map((d: { data: number[] }) => d.data.at(-1)), [130, 140]);
  assert.deepEqual(painel.graficos.categorias.datasets.map((d: { data: number[] }) => d.data), [[60], [20]]);
  assert.equal(painel.contas[1].saldoAtual, 930);
  assert.equal(painel.contas[1].saldoPrevisto, 1230);
  const saldos = await calcularSaldosAtuaisContas(9, [1, 2]);
  assert.equal(saldos.get(2)?.variacao, -70);

  ignorarReserva = false;
  const painelReativado = await consultar(getDashboardFinanceiroVisaoGeral, query);
  assert.equal(painelReativado.cards.saldoAtual, 1060);
  assert.equal(painelReativado.cards.saldoPrevisto, 1370);
  assert.equal(painelReativado.contas[1].saldoAtual, 930);
});
