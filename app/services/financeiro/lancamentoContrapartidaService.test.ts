import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { criarLancamentoComContrapartida } from "./lancamentoContrapartidaService";
import {
  calcularValoresLancamento,
  calcularProximoVencimento,
  type criarLancamentoFinanceiro,
} from "./lancamentoService";
import { lancamentoContrapartidaSchema } from "../../schemas/lancamentoContrapartida";

const payload = (extra = {}) => ({
  chaveOperacao: randomUUID(),
  descricao: "Repasse QA",
  tipo: "RECEITA",
  valorTotal: 100.01,
  categoriaId: 7,
  clienteId: 8,
  contasFinanceiroId: 9,
  dataLancamento: "2026-11-17T12:00:00.000Z",
  formaPagamento: "PIX",
  lancamentoEfetivado: true,
  tipoLancamentoModo: "AVISTA",
  ...extra,
});
function memory() {
  let state: { operations: Map<string, any>; rows: any[] } = {
    operations: new Map(),
    rows: [],
  };
  let turn = Promise.resolve();
  const key = (where: any) =>
    `${where.contaId_chave.contaId}:${where.contaId_chave.chave}`;
  const adapter = (current: typeof state) => ({
    state: current,
    categoriaFinanceiro: {
      findFirst: async ({ where }: any) =>
        where.id === where.contaId - 3 ? { id: where.id } : null,
    },
    clientesFornecedores: {
      findFirst: async ({ where }: any) =>
        where.id === where.contaId - 2 ? { id: where.id } : null,
    },
    contasFinanceiro: {
      findFirst: async ({ where }: any) =>
        where.id === where.contaId - 1 ? { id: where.id } : null,
    },
    parametrosConta: {
      findUnique: async ({ where }: any) => ({
        contaFinanceiraPadraoId: where.contaId - 1,
      }),
    },
    modoFacilOperacao: {
      findUnique: async ({ where }: any) =>
        current.operations.get(key(where)) || null,
      create: async ({ data }: any) => {
        const k = `${data.contaId}:${data.chave}`;
        if (current.operations.has(k))
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        current.operations.set(k, data);
      },
      update: async ({ where, data }: any) => {
        Object.assign(current.operations.get(key(where)), data);
      },
    },
  });
  const db: any = {
    modoFacilOperacao: {
      findUnique: async ({ where }: any) =>
        state.operations.get(key(where)) || null,
    },
    $transaction: async (work: any) => {
      const previous = turn;
      let release = () => {};
      turn = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const draft = structuredClone(state);
      try {
        const result = await work(adapter(draft));
        state = draft;
        return result;
      } finally {
        release();
      }
    },
  };
  const create: typeof criarLancamentoFinanceiro = async (
    tx,
    contaId,
    data,
    options,
  ) => {
    assert.equal(options?.skipNotification, true);
    const values = calcularValoresLancamento(data);
    const current = (tx as any).state as typeof state;
    const row = {
      ...data,
      contaId,
      id: current.rows.length + 1,
      total: values.valorTotalDecimal.toFixed(2),
      parcelas: values.valoresParcelas.map((value, index) => ({
        valor: value.toFixed(2),
        vencimento: calcularProximoVencimento(
          data.dataLancamento,
          index,
          values.periodoParcelamento,
          values.intervaloDiasPersonalizado,
        ),
        pago: values.hasEfetivadoTotal,
      })),
    };
    current.rows.push(row);
    return {
      id: row.id,
      valorTotal: values.valorTotalDecimal,
      lancamento: row as any,
    };
  };
  return { db, create, state: () => state };
}

describe("Receita e despesa com contrapartida", () => {
  it("cria exatamente dois registros efetivados com todos os dados compartilhados e saldo líquido zero", async () => {
    const m = memory();
    const r: any = await criarLancamentoComContrapartida(
      m.db,
      10,
      payload({ notificarClienteVencimento: true }),
      m.create,
    );
    const [receita, despesa] = m.state().rows;
    assert.equal(r.replay, false);
    assert.equal(r.data.receitaId, receita.id);
    assert.equal(r.data.despesaId, despesa.id);
    assert.equal(receita.tipo, "RECEITA");
    assert.equal(despesa.tipo, "DESPESA");
    for (const field of [
      "descricao",
      "total",
      "clienteId",
      "categoriaId",
      "contasFinanceiroId",
      "dataLancamento",
      "formaPagamento",
      "parcelas",
    ])
      assert.deepEqual(receita[field], despesa[field]);
    assert.equal(Number(receita.total) - Number(despesa.total), 0);
    assert.equal(receita.parcelas[0].pago, true);
    assert.equal(receita.notificarClienteVencimento, true);
    assert.equal(despesa.notificarClienteVencimento, false);
  });
  it("preserva centavos, vencimentos, desconto, entrada e situação nas parcelas dos dois lados", async () => {
    const m = memory();
    await criarLancamentoComContrapartida(
      m.db,
      10,
      payload({
        tipo: "DESPESA",
        valorTotal: 110.01,
        desconto: 5,
        valorEntrada: 5,
        dataEntrada: "2026-11-17",
        tipoLancamentoModo: "PARCELADO",
        parcelas: 3,
        periodoParcelamento: "PERSONALIZADO",
        intervaloDiasPersonalizado: 15,
        lancamentoEfetivado: false,
        ignorado: true,
      }),
      m.create,
    );
    const [a, b] = m.state().rows;
    assert.deepEqual(a.parcelas, b.parcelas);
    assert.deepEqual(
      a.parcelas.map((p: any) => p.valor),
      ["33.34", "33.34", "33.33"],
    );
    assert.equal(a.total, "105.01");
    assert.equal(b.ignorado, true);
    assert.equal(a.valorEntrada, b.valorEntrada);
    assert.equal(a.dataEntrada, b.dataEntrada);
    assert.equal(
      a.parcelas.every((p: any) => !p.pago),
      true,
    );
  });
  it("reserva a chave atomicamente e não duplica registros em confirmações concorrentes ou repetidas", async () => {
    const m = memory(),
      data = payload();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        criarLancamentoComContrapartida(m.db, 10, data, m.create),
      ),
    );
    assert.equal(m.state().rows.length, 2);
    assert.equal(results.filter((r) => !r.replay).length, 1);
    assert.equal(
      (await criarLancamentoComContrapartida(m.db, 10, data, m.create)).replay,
      true,
    );
    await assert.rejects(
      criarLancamentoComContrapartida(
        m.db,
        10,
        { ...data, valorTotal: 200 },
        m.create,
      ),
      (e: any) => e.status === 409,
    );
    assert.equal(m.state().rows.length, 2);
  });
  it("reverte receita, despesa e reserva se a segunda escrita falhar, permitindo repetir a tentativa", async () => {
    const m = memory(),
      data = payload();
    const failure: typeof criarLancamentoFinanceiro = async (...args) => {
      const result = await m.create(...args);
      if (args[2].tipo === "DESPESA")
        throw new Error("Falha simulada depois da despesa");
      return result;
    };
    await assert.rejects(
      criarLancamentoComContrapartida(m.db, 10, data, failure),
    );
    assert.equal(m.state().rows.length, 0);
    assert.equal(m.state().operations.size, 0);
    await criarLancamentoComContrapartida(m.db, 10, data, m.create);
    assert.equal(m.state().rows.length, 2);
  });
  it("resolve uma única conta padrão e rejeita referências de outro tenant sem gravar", async () => {
    const m = memory();
    for (const field of ["categoriaId", "clienteId", "contasFinanceiroId"]) {
      await assert.rejects(
        criarLancamentoComContrapartida(
          m.db,
          10,
          payload({ [field]: 99 }),
          m.create,
        ),
      );
      assert.equal(m.state().rows.length, 0);
      assert.equal(m.state().operations.size, 0);
    }
    await criarLancamentoComContrapartida(
      m.db,
      10,
      payload({ contasFinanceiroId: null }),
      m.create,
    );
    assert.deepEqual(
      m.state().rows.map((r) => r.contasFinanceiroId),
      [9, 9],
    );
  });
  it("isola a mesma chave de operação por conta", async () => {
    const m = memory(),
      data = payload();
    await criarLancamentoComContrapartida(m.db, 10, data, m.create);
    await criarLancamentoComContrapartida(
      m.db,
      20,
      { ...data, categoriaId: 17, clienteId: 18, contasFinanceiroId: 19 },
      m.create,
    );
    assert.equal(m.state().rows.length, 4);
    assert.deepEqual(
      m.state().rows.map((r) => r.contaId),
      [10, 10, 20, 20],
    );
  });
  it("rejeita campos externos, valores inválidos e chaves ausentes antes de gravar", async () => {
    for (const extra of [
      { contaId: 99 },
      { id: 4 },
      { vendaId: 3 },
      { chaveOperacao: undefined },
      { valorTotal: 0 },
      { valorTotal: NaN },
      { valorTotal: 10.001 },
      { lancamentoEfetivado: "false" },
    ])
      assert.equal(
        lancamentoContrapartidaSchema.safeParse(payload(extra)).success,
        false,
      );
  });
});
