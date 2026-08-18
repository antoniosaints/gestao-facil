import assert from "node:assert/strict";
import test from "node:test";
import { decidePrintFailure, enqueueTicketPrintJobs, renderProductionTicket } from "./printing";

test("repete antes de esgotar tentativas e usa fallback depois", () => {
  assert.deepEqual(decidePrintFailure({ attempts: 1, maxAttempts: 3, stationId: 1, fallbackStationId: 2 }), { action: "RETRY" });
  assert.deepEqual(decidePrintFailure({ attempts: 3, maxAttempts: 3, stationId: 1, fallbackStationId: 2 }), { action: "FALLBACK", stationId: 2 });
  assert.deepEqual(decidePrintFailure({ attempts: 3, maxAttempts: 3, stationId: 1 }), { action: "FAIL" });
});

test("gera ticket termico com identificador deduplicavel e observacoes", () => {
  const output = renderProductionTicket({
    uid: "job-123",
    paper: "58mm",
    pointName: "Cozinha",
    orderCode: "R123",
    origin: "MESA",
    tableName: "Mesa 4",
    orderNote: "Sem pressa",
    createdAt: new Date("2026-08-04T12:00:00-03:00"),
    items: [{ quantity: 2, name: "Hamburguer", selections: [{ nome: "Bacon" }], note: "Sem cebola" }],
  });
  assert.match(output, /2x Hamburguer/);
  assert.match(output, /Bacon/);
  assert.match(output, /SEM CEBOLA/i);
  assert.match(output, /JOB job-123/);
});

test("enfileira uma impressao independente para cada saida simultanea", async () => {
  const created: any[] = [];
  const ticket = {
    id: 10,
    contaId: 1,
    pontoId: 20,
    sequencia: 1,
    Ponto: {
      nome: "Cozinha",
      regraImpressao: {
        ativa: true,
        estacaoId: 30,
        fallbackEstacaoId: null,
        papel: "80mm",
        vias: 1,
        imprimirPedidoCompleto: false,
        destinos: [{
          estacaoId: 31,
          fallbackEstacaoId: 32,
          papel: "58mm",
          vias: 2,
          imprimirPedidoCompleto: true,
        }],
      },
    },
  };
  const contentTicket = {
    ...ticket,
    Pedido: {
      codigo: "R-0010",
      origem: "SALAO",
      observacao: null,
      createdAt: new Date("2026-08-05T12:00:00Z"),
      Mesa: { nome: "Mesa 1" },
      itens: [{
        quantidade: 1,
        nomeSnapshot: "Hamburguer",
        tamanhoSnapshot: null,
        selecoesSnapshotJson: null,
        observacao: null,
      }],
    },
    itens: [{
      quantidade: 1,
      observacao: null,
      PedidoItem: {
        quantidade: 1,
        nomeSnapshot: "Hamburguer",
        tamanhoSnapshot: null,
        selecoesSnapshotJson: null,
        observacao: null,
      },
    }],
  };
  const tx = {
    restauranteTicketProducao: {
      findFirst: async () => ticket,
      findUniqueOrThrow: async () => contentTicket,
    },
    restauranteTrabalhoImpressao: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        const job = { id: created.length + 1, ...data };
        created.push(job);
        return job;
      },
    },
  };

  const jobs = await enqueueTicketPrintJobs(tx, 1, 10);

  assert.equal(jobs.length, 2);
  assert.deepEqual(created.map((job) => job.estacaoId), [30, 31]);
  assert.deepEqual(created.map((job) => job.vias), [1, 2]);
  assert.match(created[0].dedupeKey, /destino:30$/);
  assert.match(created[1].dedupeKey, /destino:31$/);
});

test("reimprime somente nos conectores selecionados que sao destinos do ticket", async () => {
  const created: any[] = [];
  const ticket = {
    id: 10,
    contaId: 1,
    pontoId: 20,
    sequencia: 1,
    Ponto: {
      nome: "Cozinha",
      regraImpressao: {
        ativa: true,
        estacaoId: 30,
        fallbackEstacaoId: null,
        papel: "80mm",
        vias: 1,
        imprimirPedidoCompleto: false,
        destinos: [{ estacaoId: 31, fallbackEstacaoId: null, papel: "58mm", vias: 1, imprimirPedidoCompleto: false }],
      },
    },
  };
  const tx = {
    restauranteTicketProducao: {
      findFirst: async () => ticket,
      findUniqueOrThrow: async () => ({
        ...ticket,
        Pedido: { codigo: "R-0010", origem: "RETIRADA", observacao: null, createdAt: new Date(), Mesa: null, itens: [] },
        itens: [],
      }),
    },
    restauranteTrabalhoImpressao: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        const job = { id: created.length + 1, ...data };
        created.push(job);
        return job;
      },
    },
  };

  const jobs = await enqueueTicketPrintJobs(tx, 1, 10, "manual", [31, 99]);

  assert.equal(jobs.length, 1);
  assert.equal(created[0].estacaoId, 31);
});
