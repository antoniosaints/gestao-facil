import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { prisma } from "../app/utils/prisma";
import { initSocket } from "../app/utils/socket";
import {
  callChatGeminiService,
  decideCoreIaAction,
} from "../app/external/gemini/callGemini";
import Redis from "ioredis";
import { env } from "../app/utils/dotenv";
import { actionKey } from "../app/services/ia/coreIaActions";

// This workflow owns a new inactive tenant; only synthetic records can reach the LLM.
const tag = `core-ia-qa-${randomUUID()}`;
const email = `${tag}@example.invalid`;
let tenantId: number | null = null;
let userId: number | null = null;
const actionIds: string[] = [];
const result: Record<string, unknown> = { syntheticOnly: true };
async function cleanup() {
  if (!tenantId) return;
  const owner = await prisma.contas.findUnique({
    where: { id: tenantId },
    select: { nome: true, email: true, status: true, asaasCustomerId: true },
  });
  assert.ok(
    owner &&
      owner.nome === tag &&
      owner.email === email &&
      owner.status === "INATIVO" &&
      owner.asaasCustomerId === tag,
    "Only the disposable tenant owned by this run may be removed",
  );
  const contaId = tenantId;
  await prisma.$transaction(
    async (tx) => {
      await tx.movimentacoesEstoque.deleteMany({ where: { contaId } });
      // Sale item/payment children and finance installment children cascade only from these owned rows.
      await tx.vendas.deleteMany({ where: { contaId } });
      await tx.lancamentoFinanceiro.deleteMany({ where: { contaId } });
      await tx.categoriaFinanceiro.deleteMany({ where: { contaId } });
      await tx.produto.deleteMany({ where: { contaId } });
      await tx.produtoBase.deleteMany({ where: { contaId } });
      await tx.servicos.deleteMany({ where: { contaId } });
      await tx.clientesFornecedores.deleteMany({ where: { contaId } });
      await tx.contasFinanceiro.deleteMany({ where: { contaId } });
      await (tx as any).iaUso.deleteMany({ where: { contaId } });
      await tx.parametrosConta.deleteMany({ where: { contaId } });
      await tx.usuarios.deleteMany({ where: { contaId } });
      await tx.contas.delete({ where: { id: contaId } });
    },
    { timeout: 30000 },
  );
  result.cleanupComplete = !(await prisma.contas.findUnique({
    where: { id: contaId },
    select: { id: true },
  }));
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    commandTimeout: 5000,
  });
  redis.on("error", () => {});
  try {
    if (userId && actionIds.length)
      await redis.del(
        ...actionIds.map((id) =>
          actionKey(
            {
              contaId,
              userId: userId!,
              email,
              permissao: "admin",
              contaStatus: "INATIVO",
            },
            id,
          ),
        ),
      );
  } finally {
    redis.disconnect();
  }
}
async function main() {
  if (process.env.CORE_IA_QA_LIVE !== "1") {
    console.error(
      "Teste opt-in: CORE_IA_QA_LIVE=1 npm run test:core-ia:live. Cria e remove uma conta temporária com dados fictícios no banco configurado.",
    );
    process.exit(1);
  }
  try {
    const account = await prisma.contas.create({
      data: {
        nome: tag,
        email,
        valor: 0,
        data: new Date(),
        status: "INATIVO",
        asaasCustomerId: tag,
      },
      select: { id: true },
    });
    tenantId = account.id;
    await prisma.parametrosConta.create({
      data: {
        contaId: account.id,
        eventoVendaConcluida: false,
        eventoEstoqueBaixo: false,
        eventoProdutoAlterado: false,
        eventoSangria: false,
        whatsappNotificacoesAtivo: false,
        financeiroVencimentosNotificacoesAtivo: false,
        iaLimiteTokensMensal: 1000000,
      },
    });
    const user = await prisma.usuarios.create({
      data: {
        contaId: account.id,
        nome: "Usuário Sintético de QA",
        email,
        senha: "!DISABLED-VALIDATION-ONLY",
        permissao: "admin",
        status: "INATIVO",
        pushReceiver: false,
        emailReceiver: false,
      },
    });
    userId = user.id;
    await prisma.contasFinanceiro.create({
      data: {
        contaId: account.id,
        nome: "Caixa Sintetico QA",
        saldoInicial: 0,
      },
    });
    initSocket(createServer());
    const request = {
      contaId: account.id,
      userId: user.id,
      email,
      permissao: "admin",
      contaStatus: "INATIVO",
    };
    const suffix = randomUUID().slice(0, 8);
    const audioPath = process.env.CORE_IA_QA_AUDIO_PATH;
    const client = audioPath
      ? "Synthetic QA Audio"
      : `Cliente Sintetico ${suffix}`;
    const product = `Produto Sintetico ${suffix}`;
    const service = `Servico Sintetico ${suffix}`;
    const cases = [
      [
        "client",
        `Cadastre o cliente ${client}, apenas o nome. Prepare a revisão.`,
      ],
      [
        "product",
        `Cadastre o produto ${product} por R$ 9,90, estoque inicial 5, mínimo 0. Prepare a revisão.`,
      ],
      [
        "service",
        `Cadastre o serviço ${service} por R$ 20,00. Prepare a revisão.`,
      ],
      [
        "finance",
        `Registre despesa de R$ 5,50, descrição Despesa Sintetica QA, categoria Sintetica QA, conta Caixa Sintetico QA, ainda não paga, pagamento DINHEIRO. Prepare a revisão.`,
      ],
      [
        "sale",
        `Registre venda de 2 unidades do produto ${product} ao preço do catálogo e 1 unidade do serviço ${service}, para o cliente ${client}, sem desconto, pagamento previsto OUTRO. Prepare a revisão.`,
      ],
    ];
    for (const [label, prompt] of cases) {
      const audio =
        label === "client" && audioPath
          ? {
              data: readFileSync(audioPath).toString("base64"),
              mimeType: "audio/wav",
              name: "synthetic-qa.wav",
            }
          : undefined;
      const response = await callChatGeminiService(
        request,
        prompt,
        [],
        undefined,
        audio,
      );
      if (audio) {
        assert.ok(
          response.transcript?.trim(),
          "Expected audio transcription before preparing the client",
        );
        result.audioPipeline = true;
      }
      assert.equal(
        response.pendingActions?.length,
        1,
        `Expected one ${label} review`,
      );
      const id = response.pendingActions[0].id;
      actionIds.push(id);
      const confirmation = await decideCoreIaAction(id, "confirm", request);
      assert.match(
        confirmation.reply || "",
        /sucesso/,
        `${label} must acknowledge execution`,
      );
      const replay = await decideCoreIaAction(id, "confirm", request);
      assert.equal(replay.reply, confirmation.reply);
      result[label] = { prepared: true, confirmed: true, replaySafe: true };
      console.log(JSON.stringify({ phase: label, passed: true }));
    }
    const [clients, products, services, finances, sales] = await Promise.all([
      prisma.clientesFornecedores.count({ where: { contaId: account.id } }),
      prisma.produto.findMany({
        where: { contaId: account.id },
        select: { estoque: true },
      }),
      prisma.servicos.count({ where: { contaId: account.id } }),
      prisma.lancamentoFinanceiro.findMany({
        where: { contaId: account.id },
        include: { parcelas: true },
      }),
      prisma.vendas.findMany({
        where: { contaId: account.id },
        include: { ItensVendas: true, PagamentoVendas: true },
      }),
    ]);
    assert.equal(clients, 1);
    assert.equal(products.length, 1);
    assert.equal(Number(products[0].estoque), 3);
    assert.equal(services, 1);
    assert.equal(finances.length, 1);
    assert.equal(finances[0].status, "PENDENTE");
    assert.equal(finances[0].parcelas.length, 1);
    assert.equal(Number(finances[0].parcelas[0].valor), 5.5);
    assert.equal(finances[0].parcelas[0].pago, false);
    assert.equal(sales.length, 1);
    assert.equal(sales[0].status, "FINALIZADO");
    assert.equal(Number(sales[0].valor), 39.8);
    assert.equal(sales[0].ItensVendas.length, 2);
    assert.equal(sales[0].PagamentoVendas?.status, "PENDENTE");
    assert.equal(
      await prisma.movimentacoesEstoque.count({
        where: { contaId: account.id, tipo: "SAIDA" },
      }),
      1,
    );
    result.stockAfterSale = 3;
    result.saleTotal = 39.8;
    result.databaseAssertions = true;
  } catch (error: any) {
    result.failureType = error?.name || "Error";
    result.failureCode = error?.code || "validation_failed";
  } finally {
    try {
      await cleanup();
    } catch (error: any) {
      result.cleanupComplete = false;
      result.cleanupError = error?.name || "Error";
      result.disposableTenantTag = tag;
    }
    console.log(JSON.stringify(result));
    await prisma.$disconnect();
    process.exit(result.databaseAssertions && result.cleanupComplete ? 0 : 1);
  }
}
main();
