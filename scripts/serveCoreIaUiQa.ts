/** Local UI QA: real auth, controller, provider and persistence; disposable synthetic tenant only. */
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import express from "express";
import { createServer } from "node:http";
import Redis from "ioredis";
import { prisma } from "../app/utils/prisma";
import { env } from "../app/utils/dotenv";
import { JwtUtil } from "../app/utils/jwt";
import { initSocket } from "../app/utils/socket";
import { authenticateJWT } from "../app/middlewares/auth";
import { callChatGemini } from "../app/controllers/inteligence/gemini";
import { meuUsoIa } from "../app/controllers/ia/uso";
import { getCustomRequest } from "../app/helpers/getCustomRequest";

const tag = `core-ia-ui-qa-${randomUUID()}`;
const email = `${tag}@example.invalid`;
const secret = randomBytes(24).toString("hex");
const controlFile = "/tmp/core-ia-ui-qa-control.json";
let contaId: number | undefined;
let userId: number | undefined;
let finishing = false;
const app = express();
const server = createServer(app);
app.use(express.json({ limit: "15mb" }));
async function state() {
  assert.ok(contaId);
  const where = { contaId };
  const [clients, products, services, entries, sales, movements] =
    await Promise.all([
      prisma.clientesFornecedores.findMany({ where, select: { nome: true } }),
      prisma.produto.findMany({
        where,
        select: { nome: true, estoque: true, preco: true },
      }),
      prisma.servicos.findMany({ where, select: { nome: true, preco: true } }),
      prisma.lancamentoFinanceiro.findMany({
        where,
        select: { descricao: true, valorTotal: true, status: true },
      }),
      prisma.vendas.findMany({
        where,
        select: {
          valor: true,
          status: true,
          cliente: { select: { nome: true } },
          ItensVendas: { select: { itemName: true, quantidade: true } },
          PagamentoVendas: { select: { status: true } },
        },
      }),
      prisma.movimentacoesEstoque.count({ where: { ...where, tipo: "SAIDA" } }),
    ]);
  return { clients, products, services, entries, sales, movements };
}
async function cleanup() {
  if (!contaId) return;
  const owner = await prisma.contas.findUnique({
    where: { id: contaId },
    select: { nome: true, email: true, asaasCustomerId: true, status: true },
  });
  assert.ok(
    owner?.nome === tag &&
      owner.email === email &&
      owner.asaasCustomerId === tag &&
      owner.status === "INATIVO",
  );
  const id = contaId;
  await prisma.$transaction(
    async (tx) => {
      await tx.movimentacoesEstoque.deleteMany({ where: { contaId: id } });
      await tx.vendas.deleteMany({ where: { contaId: id } });
      await tx.lancamentoFinanceiro.deleteMany({ where: { contaId: id } });
      await tx.categoriaFinanceiro.deleteMany({ where: { contaId: id } });
      await tx.produto.deleteMany({ where: { contaId: id } });
      await tx.produtoBase.deleteMany({ where: { contaId: id } });
      await tx.servicos.deleteMany({ where: { contaId: id } });
      await tx.clientesFornecedores.deleteMany({ where: { contaId: id } });
      await tx.contasFinanceiro.deleteMany({ where: { contaId: id } });
      await tx.iaUso.deleteMany({ where: { contaId: id } });
      await tx.moduloOnConta.deleteMany({ where: { contaId: id } });
      await tx.parametrosConta.deleteMany({ where: { contaId: id } });
      await tx.usuarios.deleteMany({ where: { contaId: id } });
      await tx.contas.delete({ where: { id } });
    },
    { timeout: 30000 },
  );
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    connectTimeout: 5000,
    commandTimeout: 5000,
    maxRetriesPerRequest: 1,
  });
  redis.on("error", () => {});
  try {
    let cursor = "0";
    do {
      const page = await redis.scan(
        cursor,
        "MATCH",
        `core-ia:action:${id}:${userId}:*`,
        "COUNT",
        100,
      );
      cursor = page[0];
      if (page[1].length) await redis.del(...page[1]);
    } while (cursor !== "0");
  } finally {
    redis.disconnect();
  }
  assert.equal(await prisma.contas.count({ where: { id } }), 0);
}
async function finish() {
  if (finishing) return;
  finishing = true;
  try {
    const saved = await state();
    await cleanup();
    console.log(JSON.stringify({ saved, cleanupComplete: true }));
    try {
      unlinkSync(controlFile);
    } catch {}
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error(
      JSON.stringify({
        cleanupComplete: false,
        tag,
        errorType: error instanceof Error ? error.name : "Error",
      }),
    );
    process.exit(1);
  }
}
async function main() {
  if (process.env.CORE_IA_QA_UI !== "1")
    throw new Error("Opt-in: CORE_IA_QA_UI=1 npm run qa:core-ia:ui");
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
  contaId = account.id;
  await prisma.parametrosConta.create({
    data: {
      contaId,
      eventoVendaConcluida: false,
      eventoEstoqueBaixo: false,
      eventoProdutoAlterado: false,
      eventoSangria: false,
      whatsappNotificacoesAtivo: false,
      financeiroVencimentosNotificacoesAtivo: false,
      iaLimiteTokensMensal: 2000000,
    },
  });
  const user = await prisma.usuarios.create({
    data: {
      contaId,
      nome: "Operador QA",
      email,
      senha: "!DISABLED-UI-QA-NO-LOGIN",
      permissao: "admin",
      status: "INATIVO",
      pushReceiver: false,
      emailReceiver: false,
    },
    select: { id: true },
  });
  userId = user.id;
  const module = await prisma.modulosAdicionais.findUniqueOrThrow({
    where: { codigo: "core-ia" },
    select: { id: true },
  });
  await prisma.moduloOnConta.create({
    data: {
      contaId,
      moduloId: module.id,
      status: "ATIVO",
      valorAdicional: 0,
      vencimento: new Date(Date.now() + 86400000),
    },
  });
  await prisma.contasFinanceiro.create({
    data: { contaId, nome: "Caixa QA", saldoInicial: 0 },
  });
  const jwt = JwtUtil.encode(
    { id: user.id, contaId, email, permissao: "admin", tv: 0 },
    7200,
  );
  app.get("/qa/context", (_req, res) => {
    res.json({
      token: jwt,
      user: { id: user.id, contaId, nome: "Operador QA" },
    });
  });
  app.get("/qa/state", authenticateJWT, async (req, res) => {
    if (getCustomRequest(req).customData.contaId !== contaId)
      return void res.sendStatus(403);
    res.json(await state());
  });
  app.post("/api/gemini/chat", authenticateJWT, callChatGemini);
  app.get("/api/ia/uso", authenticateJWT, meuUsoIa);
  app.post("/qa/finish", (req, res) => {
    if (req.headers.authorization !== `Qa ${secret}`)
      return void res.sendStatus(403);
    res.json({ finishing: true });
    setTimeout(() => void finish(), 50);
  });
  initSocket(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(4174, "127.0.0.1", () => resolve());
  });
  writeFileSync(controlFile, JSON.stringify({ port: 4174, secret }), {
    mode: 0o600,
  });
  process.on("SIGINT", () => void finish());
  process.on("SIGTERM", () => void finish());
  console.log(
    "CORE_IA_UI_QA_READY http://127.0.0.1:4174 (synthetic tenant only)",
  );
}
main().catch(async (error) => {
  console.error(
    JSON.stringify({
      startupFailed: true,
      tag,
      errorType: error instanceof Error ? error.name : "Error",
    }),
  );
  await finish();
});
