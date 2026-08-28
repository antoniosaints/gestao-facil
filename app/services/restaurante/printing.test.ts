import assert from "node:assert/strict";
import test from "node:test";
import {
  decidePrintFailure,
  enqueueOrderPrintJobs,
  enqueueTicketPrintJobs,
  renderCompleteOrderReceipt,
  renderProductionTicket,
} from "./printing";

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

function completeReceipt(paper: "58mm" | "80mm") {
  return renderCompleteOrderReceipt({
    uid: "123e4567-e89b-12d3-a456-426614174000",
    paper,
    pointName: "Expedicao",
    businessName: "Restaurante Sabor da Casa",
    businessAddress: "Rua Central, 150 - Centro",
    businessPhone: "(11) 99999-9999",
    orderCode: "R-2048",
    origin: "DELIVERY",
    customerName: "Maria Aparecida de Oliveira",
    customerPhone: "(11) 98888-7777",
    customerEmail: "maria@example.com",
    deliveryAddress: {
      logradouro: "Avenida das Palmeiras",
      numero: "1234",
      complemento: "Apartamento 52, bloco B",
      bairro: "Jardim Primavera",
      cidade: "Sao Paulo",
      uf: "SP",
      cep: "01234-567",
      referencia: "Proximo ao mercado municipal",
    },
    paymentMethod: "NA_ENTREGA",
    paymentStatus: "NA_ENTREGA",
    subtotal: "42.50",
    deliveryFee: "7.00",
    discount: "2.50",
    total: "47.00",
    orderNote: "Interfone sem funcionar; ligar ao chegar",
    createdAt: new Date("2026-08-28T18:45:00-03:00"),
    items: [{
      quantity: 2,
      name: "Hamburguer artesanal completo",
      unitPrice: "21.25",
      subtotal: "42.50",
      size: "Grande",
      selections: [{ grupoNome: "Adicional", nome: "Bacon crocante" }],
      note: "Sem cebola",
    }],
  });
}

test("gera o modelo completo com cliente, endereco, valores e pagamento", () => {
  const output = completeReceipt("80mm");
  assert.match(output, /PEDIDO R-2048/);
  assert.match(output, /CLIENTE/);
  assert.match(output, /Maria Aparecida de Oliveira/);
  assert.match(output, /ENDERECO DE ENTREGA/);
  assert.match(output, /Avenida das Palmeiras/);
  assert.match(output, /PAGAMENTO/);
  assert.match(output, /\* COBRAR DO CLIENTE \*/);
  assert.match(output, /Subtotal:\s+R\$ 42,50/);
  assert.match(output, /Taxa de entrega:\s+R\$ 7,00/);
  assert.match(output, /TOTAL:\s+R\$ 47,00/);
});

test("mantem todas as linhas de texto dentro das larguras de 58mm e 80mm", () => {
  for (const [paper, columns] of [["58mm", 32], ["80mm", 40]] as const) {
    const textLines = completeReceipt(paper)
      .replace(/\x1B(?:@|a.|E.|!.|d.)/g, "")
      .replace(/\x1D(?:V.)/g, "")
      .split("\n");
    assert.equal(
      textLines.every((line) => line.length <= columns),
      true,
      `${paper} possui linha maior que ${columns} colunas: ${textLines.find((line) => line.length > columns)}`,
    );
    assert.ok(textLines.includes("-".repeat(columns)));
  }
});

test("imprime comprovante completo diretamente quando o pedido nao usa KDS", async () => {
  const created: any[] = [];
  const tx = {
    restaurantePedido: {
      findFirst: async () => ({
        id: 77,
        status: "CONFIRMADO",
        codigo: "R-0077",
        origem: "RETIRADA",
        pagamentoStatus: "NA_ENTREGA",
        pagamentoMetodoSnapshot: "NA_ENTREGA",
        clienteNomeSnapshot: "Cliente sem KDS",
        clienteTelefone: "(11) 90000-0000",
        clienteEmail: null,
        enderecoSnapshotJson: null,
        subtotal: "18.00",
        frete: "0.00",
        desconto: "0.00",
        total: "18.00",
        observacao: null,
        createdAt: new Date("2026-08-28T12:00:00-03:00"),
        Mesa: null,
        Conta: { nome: "Restaurante Teste", nomeFantasia: null, endereco: null, telefone: null },
        itens: [{
          quantidade: 1,
          nomeSnapshot: "Tapioca",
          precoUnitarioSnapshot: "18.00",
          subtotalSnapshot: "18.00",
          tamanhoSnapshot: null,
          selecoesSnapshotJson: null,
          observacao: null,
        }],
      }),
    },
    restauranteEstacaoImpressao: {
      findMany: async () => [{ id: 9, papelReportado: "58mm" }],
    },
    restauranteTrabalhoImpressao: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        const job = { id: 1, ...data };
        created.push(job);
        return job;
      },
    },
  };

  const jobs = await enqueueOrderPrintJobs(tx, 1, 77, [9], "manual-sem-kds");

  assert.equal(jobs.length, 1);
  assert.equal(created[0].pedidoId, 77);
  assert.equal(created[0].ticketId, undefined);
  assert.equal(created[0].pontoId, undefined);
  assert.equal(created[0].papel, "58mm");
  assert.match(created[0].conteudo, /CLIENTE/);
  assert.match(created[0].conteudo, /TOTAL:\s+R\$ 18,00/);
});

test("nao permite impressao direta de pedido ainda recebido", async () => {
  const tx = {
    restaurantePedido: {
      findFirst: async () => ({ id: 78, status: "RECEBIDO" }),
    },
    restauranteEstacaoImpressao: {
      findMany: async () => assert.fail("pedido recebido nao deve consultar destinos"),
    },
    restauranteTrabalhoImpressao: {
      create: async () => assert.fail("pedido recebido nao deve gerar trabalho"),
    },
  };

  assert.deepEqual(await enqueueOrderPrintJobs(tx, 1, 78, [9], "manual-recebido"), []);
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
      pagamentoStatus: "PAGO",
      pagamentoMetodoSnapshot: "PIX",
      clienteNomeSnapshot: "Cliente Teste",
      clienteTelefone: "(11) 99999-9999",
      clienteEmail: null,
      enderecoSnapshotJson: null,
      subtotal: "20.00",
      frete: "0.00",
      desconto: "0.00",
      total: "20.00",
      observacao: null,
      createdAt: new Date("2026-08-05T12:00:00Z"),
      Mesa: { nome: "Mesa 1" },
      Conta: { nome: "Restaurante Teste", nomeFantasia: null, endereco: null, telefone: null },
      itens: [{
        quantidade: 1,
        nomeSnapshot: "Hamburguer",
        precoUnitarioSnapshot: "20.00",
        subtotalSnapshot: "20.00",
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
  assert.doesNotMatch(created[0].conteudo, /CLIENTE/);
  assert.match(created[1].conteudo, /CLIENTE/);
  assert.match(created[1].conteudo, /TOTAL:\s+R\$ 20,00/);
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
