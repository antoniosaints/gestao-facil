/** Actual ERP controllers, JWT and database, limited to a disposable synthetic tenant. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createServer } from 'node:http';
import { prisma } from '../app/utils/prisma';
import { authenticateJWT } from '../app/middlewares/auth';
import { getCustomRequest } from '../app/helpers/getCustomRequest';
import { JwtUtil } from '../app/utils/jwt';
import { initSocket } from '../app/utils/socket';
import { routerClientes } from '../app/routers/clientes/router';
import { routerProdutos } from '../app/routers/produtos/router';
import { routerLancamentos } from '../app/routers/lancamentos/router';
import { routerModoFacil } from '../app/modofacil/router';

const tag = `input-persistence-qa-${randomUUID()}`;
const email = `${tag}@example.invalid`;
const secret = randomBytes(24).toString('hex');
const controlFile = '/tmp/input-persistence-qa-control.json';
const output = resolve(__dirname, '../../output/input-masks-live', process.env.INPUT_QA_PHASE || 'phase1') + '/';
const app = express(), server = createServer(app);
let contaId: number | undefined, userId: number | undefined, finishing = false, sequence = 0;
const traffic: { method: string; path: string; body: unknown; status: number }[] = [];
const snapshots = new Set<Promise<unknown>>();
mkdirSync(output, { recursive: true });
async function state() {
  assert.ok(contaId);
  const where = { contaId };
  const [clients, products, entries] = await Promise.all([
    prisma.clientesFornecedores.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.produtoBase.findMany({ where, include: { variantes: true }, orderBy: { id: 'asc' } }),
    prisma.lancamentoFinanceiro.findMany({ where, include: { parcelas: { orderBy: { numero: 'asc' } } }, orderBy: { id: 'asc' } }),
  ]);
  return { syntheticOnly: true, tag, clients, products, entries };
}
async function cleanup() {
  if (!contaId) return;
  const owner = await prisma.contas.findUniqueOrThrow({ where: { id: contaId } });
  assert.equal(owner.nome, tag); assert.equal(owner.email, email); assert.equal(owner.asaasCustomerId, tag);
  const where = { contaId };
  await prisma.$transaction(async tx => {
    await tx.modoFacilOperacao.deleteMany({ where });
    await tx.movimentacoesEstoque.deleteMany({ where });
    await tx.lancamentoFinanceiro.deleteMany({ where });
    await tx.produto.deleteMany({ where });
    await tx.produtoBase.deleteMany({ where });
    await tx.produtoCategoria.deleteMany({ where });
    await tx.clientesFornecedores.deleteMany({ where });
    await tx.categoriaFinanceiro.deleteMany({ where });
    await tx.contasFinanceiro.deleteMany({ where });
    await tx.modoFacilConfiguracao.deleteMany({ where });
    await tx.parametrosConta.deleteMany({ where });
    await tx.usuarios.deleteMany({ where });
    await tx.contas.delete({ where: { id: contaId } });
  }, { timeout: 30000 });
  assert.equal(await prisma.contas.count({ where: { id: contaId } }), 0);
}
async function finish() {
  if (finishing) return;
  finishing = true;
  try {
    await Promise.allSettled([...snapshots]);
    const saved = contaId ? await state() : null;
    await cleanup();
    writeFileSync(output + 'final.json', JSON.stringify({ saved, traffic, cleanupComplete: true }, null, 2));
    try { unlinkSync(controlFile); } catch {}
    await prisma.$disconnect();
    console.log('INPUT_PERSISTENCE_QA_CLEANUP_COMPLETE'); process.exit(0);
  } catch (error) {
    console.error('QA cleanup failed:', error instanceof Error ? error.message : 'unknown'); process.exit(1);
  }
}
async function main() {
  assert.equal(process.env.INPUT_PERSISTENCE_QA, '1', 'Opt-in: INPUT_PERSISTENCE_QA=1');
  contaId = (await prisma.contas.create({ data: { nome: tag, email, asaasCustomerId: tag, valor: 0, data: new Date(), status: 'ATIVO' } })).id;
  await prisma.parametrosConta.create({ data: { contaId, whatsappNotificacoesAtivo: false, financeiroVencimentosNotificacoesAtivo: false, eventoVendaConcluida: false, eventoEstoqueBaixo: false, eventoProdutoAlterado: false, eventoSangria: false } });
  const user = await prisma.usuarios.create({ data: { contaId, nome: 'Operador QA', email, senha: '!DISABLED-QA-NO-LOGIN', permissao: 'admin', status: 'ATIVO', pushReceiver: false, emailReceiver: false } });
  userId = user.id;
  const account = await prisma.contasFinanceiro.create({ data: { contaId, nome: 'Conta QA Máscaras', saldoInicial: 0 } });
  const category = await prisma.categoriaFinanceiro.create({ data: { contaId, nome: 'Categoria QA Máscaras' } });
  await prisma.produtoCategoria.create({ data: { contaId, nome: 'Produtos QA' } });
  const token = JwtUtil.encode({ id: userId, contaId, email, permissao: 'admin', tv: 0 }, 7200);
  app.use(express.json());
  app.get('/qa/context', (_req, res) => { res.json({ token, user: { id: userId, contaId, nome: 'Operador QA', permissao: 'admin', superAdmin: false }, defaults: { accountId: account.id, categoryId: category.id } }); });
  app.use('/qa/state', authenticateJWT, async (req, res) => {
    if (getCustomRequest(req).customData.contaId !== contaId) return void res.sendStatus(403);
    res.json({ ...await state(), traffic });
  });
  app.use('/api', authenticateJWT, (req, res, next) => {
    if (getCustomRequest(req).customData.contaId !== contaId) return void res.sendStatus(403);
    if (finishing) return void res.sendStatus(503);
    const record = { method: req.method, path: req.originalUrl, body: structuredClone(req.body ?? null), status: 0 };
    res.once('finish', () => {
      record.status = res.statusCode; traffic.push(record);
      if (!['POST', 'PATCH', 'PUT'].includes(record.method)) return;
      const number = ++sequence;
      const task = state().then(saved => writeFileSync(output + `snapshot-${String(number).padStart(2, '0')}.json`, JSON.stringify({ request: record, saved }, null, 2)));
      snapshots.add(task); void task.finally(() => snapshots.delete(task));
    });
    next();
  });
  app.use('/api/clientes', routerClientes);
  app.use('/api/produtos', routerProdutos);
  app.use('/api/lancamentos', routerLancamentos);
  app.use('/api/modofacil', routerModoFacil);
  app.post('/qa/finish', (req, res) => {
    if (req.headers.authorization !== `Qa ${secret}`) return void res.sendStatus(403);
    res.json({ finishing: true }); setTimeout(() => void finish(), 50);
  });
  initSocket(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(4184, '127.0.0.1', resolve); });
  writeFileSync(controlFile, JSON.stringify({ port: 4184, secret }), { mode: 0o600 });
  process.on('SIGINT', () => void finish()); process.on('SIGTERM', () => void finish());
  console.log('INPUT_PERSISTENCE_QA_READY http://127.0.0.1:4184 (synthetic tenant only)');
}
main().catch(async error => { console.error('QA startup failed:', error instanceof Error ? error.message : 'unknown'); await finish(); });
