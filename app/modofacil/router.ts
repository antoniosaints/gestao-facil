import { Router, type RequestHandler, type ErrorRequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticateJWT } from "../middlewares/auth";
import { prisma } from "../utils/prisma";
import { handleError } from "../utils/handleError";
import { getCustomRequest } from "../helpers/getCustomRequest";
import { sendSessionUpdated } from "../hooks/contas/socket";
import { sendFinanceiroUpdated } from "../hooks/financeiro/socket";
import { createConfiguracaoRouter } from "./configuracao/router";
import { requireAccess } from "./access";
import { criarProduto, editarProduto, reporEstoque, descartarEstoque } from "./produtos/service";
import { executarUmaVez } from "./idempotencia";
import { criarLancamentoFinanceiro } from "../services/financeiro/lancamentoService";
import { lancamentoSchema, lancamentoBasicoSchema, pessoaSchema, pessoaPatchSchema, servicoSchema } from "./adapters/schemas";
import { vendaSchema, efetivarVendaSchema } from "../schemas/vendas";
import { saveOrdemServicoSchema, efetivarOsSchema } from "../schemas/ordemservico";
import { finalizarVendaPdvSchema } from "../schemas/caixas";
import { ModoFacilError } from "./errors";
import { uploadImagem } from "./produtos/imagemUpload";
import { notificarProduto } from "./adapters/notificacoes";
import * as domain from "./adapters/operacoes";
import * as extras from "./adapters/operacoesExtras";
import { createOperacoesRouter } from "./operacoes/router";
import { contaHasActiveModule } from "../services/contas/storeModulesService";
import { syncAuthenticatedSessionCaches } from "../services/session/accountSessionCacheService";

export const routerModoFacil = Router();
routerModoFacil.use(authenticateJWT, requireAccess(prisma));
const session = (req: Parameters<RequestHandler>[0]) => getCustomRequest(req).customData;
const route = (action: (...args: Parameters<RequestHandler>) => unknown): RequestHandler => (req, res, next) => { Promise.resolve(action(req, res, next)).catch(next); };
const id = (value: unknown) => z.coerce.number().int().positive().parse(value);
const body = (schema: z.ZodTypeAny): RequestHandler => (req, _res, next) => {
  try { req.body = schema.parse(req.body); next(); } catch (error) { next(error); }
};
const ok = (res: Parameters<RequestHandler>[1], data: unknown, status = 200) => res.status(status).json({ status, message: "Operação realizada", data });
// Socket failure must not turn a committed write into an apparent failure/retry.
function notify(action: () => void) { try { action(); } catch { console.warn("[modofacil] Atualização persistida; socket indisponível."); } }

routerModoFacil.use(createConfiguracaoRouter(prisma, (contaId, result) => sendSessionUpdated(contaId, { modoFacil: result })));
routerModoFacil.use(createOperacoesRouter(prisma, extras, {
  venda: (tx, id, data, session) => extras.atualizarVendaTx(tx, id, data, session, { restoreComboVendaStock: extras.restoreComboVendaStock, createComboVendaSaidas: extras.createComboVendaSaidas }),
  os: (tx, id, data, session) => extras.atualizarOrdemTx(tx, id, data, session, { restoreComboOrdemStock: extras.restoreComboOrdemStock, createComboOrdemSaidas: extras.createComboOrdemSaidas }),
  hasCombos: contaId => contaHasActiveModule(contaId, "combos"),
}, async (contaId, userId) => {
  await syncAuthenticatedSessionCaches(contaId, userId);
  notify(() => sendSessionUpdated(contaId, { reason: "parametros-operacionais-atualizados" }));
}, contaId => notificarProduto(contaId, "Alteração de produto", "Um cadastro ou uma entrada de estoque foi registrado.")));

const produtos = Router();
produtos.use(requireAccess(prisma, 4));
produtos.get("/", route(domain.tableProdutos));
produtos.get("/categorias", domain.getCategoriasProduto);
produtos.post("/categorias", domain.saveCategoriaProduto);
produtos.get("/variantes/:id", domain.getProdutoVariante);
produtos.get("/:id/variantes", domain.getVariantesProduto);
produtos.get("/:id", domain.getProduto);
produtos.post("/", route(async (req, res) => {
  const result = await criarProduto(prisma, session(req).contaId, req.body);
  if (!result.replay) await notificarProduto(session(req).contaId, "Cadastro de produto", "Um produto foi cadastrado no sistema.");
  ok(res, result.data, result.replay ? 200 : 201);
}));
produtos.patch("/:produtoBaseId/variantes/:varianteId/basico", route(async (req, res) => {
  const result = await editarProduto(prisma, session(req).contaId, id(req.params.produtoBaseId), id(req.params.varianteId), req.body);
  await notificarProduto(session(req).contaId, "Atualização de produto", "Os dados básicos de um produto foram atualizados.");
  ok(res, result);
}));
produtos.post("/variantes/:id/imagem", uploadImagem.single("file"), domain.uploadVarianteImagem);
produtos.delete("/variantes/:id/imagem", domain.deleteVarianteImagem);
routerModoFacil.use("/produtos", produtos);
const estoque = Router();
estoque.use(requireAccess(prisma, 4));
estoque.post("/reposicao", route(async (req, res) => {
  const result = await reporEstoque(prisma, session(req).contaId, req.body);
  await notificarProduto(session(req).contaId, "Reposição de produto", "Uma reposição de estoque foi registrada.");
  ok(res, { ...result.movimentacao, Produto: result.produto }, 201);
}));
estoque.post("/descarte", route(async (req, res) => {
  const produto = await descartarEstoque(prisma, session(req).contaId, req.body);
  await notificarProduto(session(req).contaId, "Descarte de produto", "Um descarte de estoque foi registrado.");
  ok(res, { produto, quantidade: req.body.quantidade, motivo: req.body.motivo });
}));
estoque.get("/movimentacoes/resumo", domain.resumoMovimentacoes);
estoque.get("/movimentacoes", domain.tableMovimentacoes);
routerModoFacil.use("/estoque", estoque);

// Validate foreign resources in the account before reaching legacy operations.
const financialRefs: RequestHandler = route(async (req, _res, next) => {
  const contaId = session(req).contaId;
  const payload = req.body ?? {};
  const categoriaId = payload.categoria ?? payload.categoriaId;
  const clienteId = payload.clienteId;
  const conta = payload.conta ?? payload.contasFinanceiroId;
  if (categoriaId != null && !(await prisma.categoriaFinanceiro.findFirst({ where: { id: id(categoriaId), contaId }, select: { id: true } }))) throw new ModoFacilError(404, "category_not_found", "Categoria financeira não encontrada.");
  if (clienteId != null && !(await prisma.clientesFornecedores.findFirst({ where: { id: id(clienteId), contaId }, select: { id: true } }))) throw new ModoFacilError(404, "person_not_found", "Pessoa não encontrada.");
  if (conta != null && !(await prisma.contasFinanceiro.findFirst({ where: { id: id(conta), contaId }, select: { id: true } }))) throw new ModoFacilError(404, "account_not_found", "Conta financeira não encontrada.");
  next();
});
// Full domain schemas are validated without replacing input with transformed
// Dates (legacy handlers perform their own parsing). Reduced edits are denied.
const novaOperacao = (schema: z.ZodTypeAny, os = false): RequestHandler => route(async (req, _res, next) => {
  schema.parse(req.body);
  if (req.body.id != null || req.query.id != null) throw new ModoFacilError(422, "full_edit_required", "Edição de itens exige o fluxo completo; este endpoint cria uma nova operação.");
  if (os && req.body.status === "FATURADA") throw new ModoFacilError(422, "invalid_transition", "Fature a OS pela operação de faturamento após criar.");
  const contaId = session(req).contaId;
  if (req.body.vendedorId && !(await prisma.usuarios.findFirst({ where: { id: id(req.body.vendedorId), contaId, status: "ATIVO" }, select: { id: true } }))) throw new ModoFacilError(404, "user_not_found", "Responsável não encontrado.");
  for (const item of req.body.itens) {
    if (!Number.isInteger(item.quantidade) || item.quantidade <= 0 || !Number.isFinite(item.preco ?? item.valor) || (item.preco ?? item.valor) < 0) {
      throw new ModoFacilError(422, "invalid_item", "Vendas e OS atualmente exigem quantidades inteiras e valores não negativos. O cadastro e as operações de estoque aceitam frações.");
    }
  }
  next();
});

const vendas = Router();
vendas.use(requireAccess(prisma, 2));
vendas.get("/", route(domain.tableVendas));
vendas.get("/produtos", domain.select2Produtos);
vendas.get("/caixa/contexto", domain.getContextoCaixa);
vendas.post("/caixa/abrir", domain.abrirCaixa);
vendas.put("/caixa/fechar", domain.fecharCaixa);
vendas.post("/caixa/movimentar", domain.movimentarCaixa);
vendas.post("/caixa/finalizar-venda", novaOperacao(finalizarVendaPdvSchema), financialRefs, route(domain.finalizarVendaPdv));
vendas.post("/", novaOperacao(vendaSchema), financialRefs, domain.saveVenda);
vendas.get("/:id", domain.getVenda);
vendas.post("/:id/efetivar", body(efetivarVendaSchema), financialRefs, domain.efetivarVenda);
vendas.post("/:id/estornar", domain.estornarVenda);
routerModoFacil.use("/vendas", vendas);

const financeiro = Router();
financeiro.use(requireAccess(prisma, 3));
financeiro.get("/resumo", domain.getDashboardFinanceiroVisaoGeral);
financeiro.get("/lancamentos", route(domain.tableFinanceiro));
financeiro.get("/categorias", domain.listCategorias);
financeiro.get("/contas", domain.listContasFinanceiro);
financeiro.post("/lancamentos", body(lancamentoSchema), financialRefs, route(async (req, res) => {
  const { chaveOperacao, ...data } = lancamentoSchema.parse(req.body);
  const result = await executarUmaVez(prisma, session(req).contaId, chaveOperacao, { operacao: "lancamentoManual", ...data }, tx =>
    criarLancamentoFinanceiro(tx, session(req).contaId, { ...data, tipoLancamentoModo: data.tipoLancamentoModo ?? "AVISTA" }, { skipNotification: true }));
  notify(() => sendFinanceiroUpdated(session(req).contaId, { reason: "lancamento-criado" }));
  ok(res, result.data, result.replay ? 200 : 201);
}));
financeiro.get("/lancamentos/:id", domain.getLacamento);
financeiro.post("/lancamentos/:id/atualizar-basico", body(lancamentoBasicoSchema), financialRefs, domain.updateLancamentoBasico);
financeiro.post("/parcelas/:id/pagar", financialRefs, domain.pagarParcela);
financeiro.post("/parcelas/:id/estornar", domain.estornarParcela);
routerModoFacil.use("/financeiro", financeiro);

const servicos = Router();
servicos.use(requireAccess(prisma, 2));
servicos.get("/", domain.tableServico);
servicos.post("/", body(servicoSchema), domain.saveServico);
servicos.get("/ordens", domain.tableOrdensServico);
servicos.post("/ordens", novaOperacao(saveOrdemServicoSchema, true), financialRefs, domain.saveOrdemServico);
servicos.get("/ordens/:id", domain.buscarOrdemDetalhe);
servicos.post("/ordens/:id/efetivar", body(efetivarOsSchema), financialRefs, domain.efetivarOrdemServico);
servicos.post("/ordens/:id/estornar", domain.estornarOrdemServico);
servicos.get("/:id", domain.getServico);
routerModoFacil.use("/servicos", servicos);

const pessoas = Router();
pessoas.use(requireAccess(prisma, 2));
pessoas.get("/", domain.tableClientes);
pessoas.post("/", body(pessoaSchema), domain.saveCliente);
pessoas.get("/:id", domain.getCliente);
pessoas.patch("/:id/basico", body(pessoaPatchSchema), route(async (req, res) => {
  const result = await prisma.clientesFornecedores.updateMany({ where: { id: id(req.params.id), contaId: session(req).contaId }, data: req.body });
  if (result.count !== 1) throw new ModoFacilError(404, "person_not_found", "Pessoa não encontrada.");
  ok(res, await prisma.clientesFornecedores.findFirst({ where: { id: id(req.params.id), contaId: session(req).contaId } }));
}));
routerModoFacil.use("/pessoas", pessoas);

const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 422).json({ status: error.code === "LIMIT_FILE_SIZE" ? 413 : 422, message: "Envie um único arquivo de até 5 MiB no campo file.", data: null });
    return;
  }
  handleError(res, error);
};
routerModoFacil.use(errors);
