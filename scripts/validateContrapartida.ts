import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { prisma } from "../app/utils/prisma";
import { JwtUtil } from "../app/utils/jwt";
import { authenticateJWT } from "../app/middlewares/auth";
import { criarReceitaDespesa } from "../app/controllers/financeiro/contrapartida";
import { criarLancamento } from "../app/controllers/financeiro/gerenciar";
import { criarLancamentoComContrapartida } from "../app/services/financeiro/lancamentoContrapartidaService";
import { criarLancamentoFinanceiro } from "../app/services/financeiro/lancamentoService";
import { calcularSaldosAtuaisContas } from "../app/services/financeiro/saldoContaFinanceiraService";
import { initSocket, getIO } from "../app/utils/socket";

const tag = "financeiro-par-qa-" + randomUUID(),
  email = tag + "@example.invalid";
let contaId: number | undefined;
let stage = "startup";
const result: Record<string, unknown> = { syntheticOnly: true };
const app = express(),
  server = createServer(app);
async function cleanup() {
  if (!contaId) return;
  const owner = await prisma.contas.findUniqueOrThrow({
    where: { id: contaId },
  });
  assert.equal(owner.nome, tag);
  assert.equal(owner.email, email);
  assert.equal(owner.asaasCustomerId, tag);
  assert.equal(owner.status, "INATIVO");
  const where = { contaId };
  await prisma.$transaction(
    async (tx) => {
      await tx.modoFacilOperacao.deleteMany({ where });
      await tx.lancamentoFinanceiro.deleteMany({ where });
      await tx.categoriaFinanceiro.deleteMany({ where });
      await tx.clientesFornecedores.deleteMany({ where });
      await tx.contasFinanceiro.deleteMany({ where });
      await tx.parametrosConta.deleteMany({ where });
      await tx.usuarios.deleteMany({ where });
      await tx.contas.delete({ where: { id: contaId } });
    },
    { timeout: 30000 },
  );
  result.cleanupComplete =
    (await prisma.contas.count({ where: { id: contaId } })) === 0;
}
async function main() {
  if (process.env.FINANCEIRO_QA_PAR !== "1")
    throw new Error("Opt-in: FINANCEIRO_QA_PAR=1");
  await prisma.modoFacilOperacao.count({ where: { contaId: -1 } });
  const conta = await prisma.contas.create({
    data: {
      nome: tag,
      email,
      status: "INATIVO",
      asaasCustomerId: tag,
      valor: 0,
      data: new Date(),
    },
  });
  contaId = conta.id;
  await prisma.parametrosConta.create({
    data: {
      contaId,
      whatsappNotificacoesAtivo: false,
      financeiroVencimentosNotificacoesAtivo: false,
    },
  });
  const cliente = await prisma.clientesFornecedores.create({
    data: { contaId, nome: "Cliente QA Par", tipo: "CLIENTE" },
  });
  const categoria = await prisma.categoriaFinanceiro.create({
    data: { contaId, nome: "Empréstimos QA" },
  });
  const banco = await prisma.contasFinanceiro.create({
    data: { contaId, nome: "Caixa QA Par", saldoInicial: 0 },
  });
  const user = await prisma.usuarios.create({
    data: {
      contaId,
      nome: "Operador QA",
      email,
      senha: "!DISABLED-QA-NO-LOGIN",
      permissao: "admin",
      status: "INATIVO",
      pushReceiver: false,
      emailReceiver: false,
    },
  });
  const token = JwtUtil.encode(
    { id: user.id, contaId, email, permissao: "admin", tv: 0 },
    3600,
  );
  app.use(express.json());
  app.post("/lancamentos", authenticateJWT, criarLancamento);
  app.post(
    "/lancamentos/receita-despesa",
    authenticateJWT,
    criarReceitaDespesa,
  );
  initSocket(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  async function post(path: string, data: unknown, authenticated = true) {
    const r = await fetch(baseUrl + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: (await r.json()) as any };
  }
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  const base = {
    descricao: "Empréstimo QA",
    tipo: "RECEITA",
    valorTotal: 37.81,
    categoriaId: categoria.id,
    clienteId: cliente.id,
    contasFinanceiroId: banco.id,
    dataLancamento: date.toISOString(),
    formaPagamento: "PIX",
    lancamentoEfetivado: true,
    tipoLancamentoModo: "AVISTA",
  };
  stage = "http-auth";
  assert.equal(
    (
      await post(
        "/lancamentos/receita-despesa",
        { ...base, chaveOperacao: randomUUID() },
        false,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await post("/lancamentos/receita-despesa", {
        ...base,
        chaveOperacao: randomUUID(),
        valorTotal: 1.001,
      })
    ).status,
    422,
  );
  stage = "legacy-single";
  assert.equal(
    (
      await post("/lancamentos", {
        ...base,
        descricao: "Individual QA",
        lancamentoEfetivado: false,
      })
    ).status,
    201,
  );
  assert.equal(
    await prisma.lancamentoFinanceiro.count({ where: { contaId } }),
    1,
  );
  stage = "concurrent-pair";
  const request = { ...base, chaveOperacao: randomUUID() };
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      post("/lancamentos/receita-despesa", request),
    ),
  );
  assert.equal(responses.filter((r) => r.status === 201).length, 1);
  assert.equal(responses.filter((r) => r.status === 200).length, 5);
  const ids = responses[0].body.data;
  assert.ok(ids.receitaId && ids.despesaId && ids.receitaId !== ids.despesaId);
  assert.equal(
    await prisma.lancamentoFinanceiro.count({ where: { contaId } }),
    3,
  );
  assert.equal(
    (await post("/lancamentos/receita-despesa", { ...request, valorTotal: 38 }))
      .status,
    409,
  );
  result.atomicReplay = true;
  result.concurrentRequests = 6;
  stage = "installments";
  const parcelado = await post("/lancamentos/receita-despesa", {
    ...base,
    chaveOperacao: randomUUID(),
    valorTotal: 110.01,
    desconto: 5,
    valorEntrada: 5,
    dataEntrada: date.toISOString(),
    tipoLancamentoModo: "PARCELADO",
    parcelas: 3,
    lancamentoEfetivado: false,
  });
  assert.equal(parcelado.status, 201);
  const installments = await prisma.parcelaFinanceiro.findMany({
    where: {
      lancamentoId: {
        in: [parcelado.body.data.receitaId, parcelado.body.data.despesaId],
      },
    },
    orderBy: [{ lancamentoId: "asc" }, { numero: "asc" }],
    select: {
      numero: true,
      valor: true,
      pago: true,
      vencimento: true,
      contaFinanceira: true,
    },
  });
  assert.equal(installments.length, 8);
  assert.deepEqual(installments.slice(0, 4), installments.slice(4));
  assert.deepEqual(
    installments.slice(1, 4).map((p) => p.valor.toString()),
    ["33.34", "33.34", "33.33"],
  );
  result.installmentsEqual = true;
  stage = "recurrence";
  const recorrente = await post("/lancamentos/receita-despesa", {
    ...base,
    chaveOperacao: randomUUID(),
    valorTotal: 25,
    tipoLancamentoModo: "RECORRENTE",
    lancamentoEfetivado: false,
    recorrencia: {
      frequencia: "MENSAL",
      dataInicio: date.toISOString(),
      dataFim: null,
      minimoGerado: 3,
      maximoEmAberto: 5,
      geracaoAutomatica: false,
      diasAntecedencia: 0,
    },
  });
  assert.equal(recorrente.status, 201);
  const recIds = [
    recorrente.body.data.receitaId,
    recorrente.body.data.despesaId,
  ];
  assert.equal(
    await prisma.lancamentoRecorrencia.count({
      where: { contaId, lancamentoId: { in: recIds } },
    }),
    2,
  );
  const recRows = await prisma.parcelaFinanceiro.findMany({
    where: { lancamentoId: { in: recIds } },
    orderBy: [{ lancamentoId: "asc" }, { numero: "asc" }],
    select: { valor: true, vencimento: true, pago: true },
  });
  assert.equal(recRows.length, 6);
  assert.deepEqual(recRows.slice(0, 3), recRows.slice(3));
  result.recurrencesEqual = true;
  stage = "rollback";
  const before = await prisma.lancamentoFinanceiro.count({
      where: { contaId },
    }),
    failedKey = randomUUID();
  await assert.rejects(
    criarLancamentoComContrapartida(
      prisma,
      contaId,
      { ...base, chaveOperacao: failedKey },
      async (...args) => {
        const created = await criarLancamentoFinanceiro(...args);
        if (args[2].tipo === "DESPESA") throw new Error("QA rollback");
        return created;
      },
    ),
  );
  assert.equal(
    await prisma.lancamentoFinanceiro.count({ where: { contaId } }),
    before,
  );
  assert.equal(
    await prisma.modoFacilOperacao.count({
      where: { contaId, chave: failedKey },
    }),
    0,
  );
  result.rollbackComplete = true;
  stage = "date-policy";
  await prisma.parametrosConta.update({
    where: { contaId },
    data: { permitirEfetivacaoFutura: false },
  });
  const future = new Date(date);
  future.setDate(future.getDate() + 1);
  assert.equal(
    (
      await post("/lancamentos/receita-despesa", {
        ...base,
        chaveOperacao: randomUUID(),
        dataLancamento: future.toISOString(),
      })
    ).status,
    422,
  );
  assert.equal(
    await prisma.lancamentoFinanceiro.count({ where: { contaId } }),
    before,
  );
  stage = "balance";
  const saldo = (await calcularSaldosAtuaisContas(contaId, [banco.id])).get(
    banco.id,
  );
  assert.equal(saldo?.variacao, 0);
  assert.equal(saldo?.entradasRealizadas, 42.81);
  assert.equal(saldo?.saidasRealizadas, 42.81);
  result.balance = saldo;
  result.legacySinglePreserved = true;
  result.datePolicyPreserved = true;
}
main()
  .then(() => {
    result.passed = true;
  })
  .catch((error) => {
    result.passed = false;
    result.failedStage = stage;
    result.errorType = error instanceof Error ? error.name : "Error";
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch {
      result.cleanupComplete = false;
      result.qaTag = tag;
    }
    console.log(JSON.stringify(result));
    try {
      getIO().close();
    } catch {}
    server.closeAllConnections();
    server.close();
    await prisma.$disconnect();
    process.exit(result.passed && result.cleanupComplete ? 0 : 1);
  });
