import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../../generated";
import { requireAccess } from "../access";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { ModoFacilError } from "../errors";
import * as schema from "./schemas";
import { criarVariante, reporLote, editarAvancado, editarPessoaAvancado, editarServicoAvancado, editarServicoBasico, editarContaFinanceira, getParametrosOperacionais, editarParametrosOperacionais, getEmpresa, editarEmpresa } from "./cadastros";
import { carregarEdicao, editarOperacao, assertEditorScope } from "./edicao";

type Handler = (...args: Parameters<RequestHandler>) => unknown;
type HandlerName = Exclude<keyof typeof import("../adapters/operacoesExtras"), "atualizarVendaTx" | "atualizarOrdemTx" | "restoreComboVendaStock" | "createComboVendaSaidas" | "restoreComboOrdemStock" | "createComboOrdemSaidas">;
type Operation = { method: "get" | "post" | "put"; path: string; level: number; handler: HandlerName; body?: z.ZodTypeAny; scope?: "charge" | "message" | "charge-create" | "person-history" | "pdf-os" };
// Explicit inventory doubles as the audited route map; no broad legacy router
// mount can accidentally expose public callbacks or platform/admin endpoints.
export const operacoesAdicionais: readonly Operation[] = [
  { method: "post", path: "/vendas/caixa/entrar", level: 2, handler: "entrarCaixa", body: z.object({ caixaId: schema.idSchema }).strict() },
  { method: "get", path: "/vendas/caixa/resumo", level: 2, handler: "resumoCaixa" },
  { method: "get", path: "/vendas/caixa/painel", level: 2, handler: "getResumoCaixas" },
  { method: "get", path: "/vendas/:id/cupom", level: 2, handler: "gerarCupomNaoFiscal" },
  { method: "get", path: "/vendas/:id/cupom-pdf", level: 2, handler: "gerarCupomPdf" },
  { method: "get", path: "/relatorios/produtos", level: 4, handler: "relatorioProdutos" },
  { method: "get", path: "/relatorios/produtos/vendas", level: 4, handler: "relatorioVendasProduto" },
  { method: "get", path: "/relatorios/produtos/lucro", level: 4, handler: "relatorioLucroProduto" },
  { method: "get", path: "/relatorios/produtos/:id/movimentacoes", level: 4, handler: "relatorioProdutoMovimentacoes" },
  { method: "get", path: "/relatorios/vendas/pdf", level: 3, handler: "getResumoVendasPDF" },
  { method: "get", path: "/relatorios/vendas/lucro", level: 3, handler: "getLucroPorVendas" },
  { method: "get", path: "/relatorios/financeiro/dre", level: 3, handler: "getDRELancamentos" },
  { method: "get", path: "/relatorios/financeiro/atrasadas", level: 3, handler: "getParcelasAtrasadas" },
  { method: "get", path: "/relatorios/financeiro/clientes", level: 3, handler: "getResumoPorCliente" },
  { method: "get", path: "/relatorios/financeiro/totais", level: 3, handler: "getLancamentosTotaisGerais" },
  { method: "get", path: "/relatorios/financeiro/demonstrativo", level: 3, handler: "getDemonstrativoFinanceiro" },
  { method: "get", path: "/relatorios/financeiro/demonstrativo/csv", level: 3, handler: "getDemonstrativoCsv" },
  { method: "get", path: "/relatorios/financeiro/demonstrativo/pdf", level: 3, handler: "getDemonstrativoPdf" },
  { method: "post", path: "/financeiro/lancamentos/:id/parcelas", level: 3, handler: "adicionarParcela", body: schema.parcelaSchema },
  { method: "post", path: "/financeiro/parcelas/:id/atualizar", level: 3, handler: "updateParcela", body: schema.parcelaAtualizacaoSchema },
  { method: "post", path: "/financeiro/parcelas/:id/pagar", level: 3, handler: "pagarParcela", body: schema.pagamentoSchema },
  { method: "post", path: "/financeiro/lancamentos/:id/recorrencia", level: 3, handler: "salvarRecorrenciaLancamento", body: schema.recorrenciaSchema },
  { method: "post", path: "/financeiro/lancamentos/:id/recorrencia/status", level: 3, handler: "atualizarStatusRecorrenciaLancamento", body: z.object({ ativo: z.boolean(), encerrar: z.boolean().default(false) }).strict() },
  { method: "post", path: "/financeiro/lancamentos/:id/recorrencia/gerar", level: 3, handler: "gerarProximaOcorrenciaRecorrencia", body: z.object({}).strict() },
  { method: "post", path: "/financeiro/contas", level: 4, handler: "saveContaFinanceiro", body: schema.contaSchema },
  { method: "post", path: "/financeiro/contas/ajustar-saldo", level: 4, handler: "ajustarSaldoContaFinanceira", body: schema.ajusteSaldoSchema },
  { method: "get", path: "/financeiro/contas/:id/detalhes", level: 3, handler: "getContaFinanceiroDetalhes" },
  { method: "get", path: "/financeiro/contas/:id/movimentacoes", level: 3, handler: "tableMovimentacoesContaFinanceira" },
  { method: "get", path: "/financeiro/contas/:id/saldo", level: 3, handler: "getContaFinanceiroSaldoAtual" },
  { method: "post", path: "/financeiro/transferencias/preview", level: 3, handler: "previewTransferirContaFinanceira", body: schema.transferenciaPreviewSchema },
  { method: "post", path: "/financeiro/transferencias", level: 3, handler: "transferirContaFinanceira", body: schema.transferenciaSchema },
  { method: "get", path: "/financeiro/categorias/arvore", level: 3, handler: "getArvoreCategorias" },
  { method: "post", path: "/financeiro/categorias", level: 3, handler: "saveCategoria", body: schema.categoriaSchema },
  { method: "post", path: "/financeiro/categorias/:id/mover", level: 3, handler: "moverCategoria", body: schema.moverCategoriaSchema },
  { method: "get", path: "/financeiro/cobrancas", level: 3, handler: "getCobrancas" },
  { method: "post", path: "/financeiro/cobrancas", level: 3, handler: "generateCobranca", body: schema.cobrancaSchema, scope: "charge-create" },
  { method: "post", path: "/financeiro/cobrancas/cancelar", level: 3, handler: "cancelarCobranca", body: schema.cobrancaAcaoSchema, scope: "charge" },
  { method: "post", path: "/financeiro/cobrancas/estornar", level: 3, handler: "estornarCobranca", body: schema.cobrancaAcaoSchema, scope: "charge" },
  { method: "get", path: "/pessoas/:id/estatisticas", level: 3, handler: "getClienteStats" },
  { method: "get", path: "/pessoas/:id/historico", level: 3, handler: "getClienteOperationalDetails", scope: "person-history" },
  { method: "get", path: "/servicos/ordens/:id/pdf", level: 2, handler: "gerarPdfOS", scope: "pdf-os" },
  { method: "post", path: "/servicos/ordens/:id/mensagens", level: 2, handler: "addNovaMensagemOrdem", body: z.object({ mensagem: schema.nonempty }).strict(), scope: "message" },
  { method: "get", path: "/servicos/ordens/resumo", level: 2, handler: "resumoOrdensServico" },
  { method: "get", path: "/relatorios/servicos/painel", level: 5, handler: "painelOrdensServico" },
];

const wrap = (action: Handler): RequestHandler => (req, res, next) => { Promise.resolve(action(req, res, next)).catch(next); };
const validate = (body?: z.ZodTypeAny): RequestHandler => (req, _res, next) => { try { if (body) req.body = body.parse(req.body); next(); } catch (error) { next(error); } };
const session = (req: Parameters<RequestHandler>[0]) => getCustomRequest(req).customData;
const numericId = (value: unknown) => z.coerce.number().int().positive().parse(value);
const ok = (res: Parameters<RequestHandler>[1], data: unknown, status = 200) => { res.status(status).json({ status, message: "Operação realizada", data }); };

export function createOperacoesRouter(
  db: PrismaClient,
  handlers: Record<HandlerName, Handler>,
  editPorts: Parameters<typeof editarOperacao>[5],
  notify: (contaId: number, userId: number) => Promise<void> = async () => undefined,
  notifyStock: (contaId: number) => Promise<void> = async () => undefined,
) {
  const router = Router();
  const access = (level: number) => requireAccess(db, level);
  const scoped = (kind: Operation["scope"]): RequestHandler => wrap(async (req, _res, next) => {
    const contaId = session(req).contaId;
    if (kind === "charge") {
      if (!(await db.cobrancasFinanceiras.findFirst({ where: { id: req.body.cobrancaId, contaId }, select: { id: true } }))) throw new ModoFacilError(404, "charge_not_found", "Cobrança não encontrada nesta conta.");
    }
    if (kind === "charge-create") {
      const origin = req.body.vinculo;
      const found = origin.tipo === "venda" ? await db.vendas.findFirst({ where: { id: origin.id, contaId }, select: { id: true, status: true, faturado: true } })
        : origin.tipo === "os" ? await db.ordensServico.findFirst({ where: { id: origin.id, contaId }, select: { id: true, status: true } })
        : await db.parcelaFinanceiro.findFirst({ where: { id: origin.id, lancamento: { contaId } }, select: { id: true, pago: true } });
      if (!found) throw new ModoFacilError(404, "origin_not_found", "Origem da cobrança não encontrada nesta conta.");
      if (("pago" in found && found.pago) || ("faturado" in found && found.faturado) || ("status" in found && ["FATURADO", "FATURADA"].includes(found.status))) throw new ModoFacilError(409, "already_paid", "A origem já está paga/faturada; use o financeiro vinculado.");
      const activeCharge = await db.cobrancasFinanceiras.findFirst({ where: { contaId, status: { in: ["PENDENTE", "EFETIVADO"] }, ...(origin.tipo === "venda" ? { vendaId: origin.id } : origin.tipo === "os" ? { ordemServicoId: origin.id } : { lancamentoId: origin.id }) }, select: { id: true } });
      if (activeCharge) throw new ModoFacilError(409, "active_charge", "Já há cobrança ativa para esta origem. Consulte ou regularize a cobrança existente.");
      if (req.body.clienteId && !(await db.clientesFornecedores.findFirst({ where: { id: req.body.clienteId, contaId }, select: { id: true } }))) throw new ModoFacilError(404, "person_not_found", "Pessoa não encontrada.");
    }
    if (kind === "message" || kind === "pdf-os") {
      const ordemId = numericId(req.params.id);
      if (!(await db.ordensServico.findFirst({ where: { id: ordemId, contaId }, select: { id: true } }))) throw new ModoFacilError(404, "operation_not_found", "OS não encontrada nesta conta.");
      if (req.query.cobrancaId && !(await db.cobrancasFinanceiras.findFirst({ where: { id: numericId(req.query.cobrancaId), contaId, ordemServicoId: ordemId }, select: { id: true } }))) throw new ModoFacilError(404, "charge_not_found", "Cobrança não vinculada a esta OS.");
    }
    if (kind === "person-history" && req.query.tab && !["cobrancas", "vendas", "lancamentos", "ordens"].includes(String(req.query.tab))) throw new ModoFacilError(422, "invalid_tab", "Aba de histórico inválida.");
    next();
  });
  for (const op of operacoesAdicionais) {
    if (typeof handlers[op.handler] !== "function") throw new Error(`Handler ausente: ${op.handler}`);
    router[op.method](op.path, access(op.level), validate(op.body), scoped(op.scope), wrap(handlers[op.handler]));
  }
  router.post("/estoque/reposicao/lote", access(4), wrap(async (req, res) => {
    const result = await reporLote(db, session(req).contaId, req.body);
    if (!result.replay) await notifyStock(session(req).contaId);
    ok(res, result.data, result.replay ? 200 : 201);
  }));
  router.post("/produtos/:produtoBaseId/variantes", access(4), wrap(async (req, res) => {
    const result = await criarVariante(db, session(req).contaId, numericId(req.params.produtoBaseId), req.body);
    if (!result.replay) await notifyStock(session(req).contaId);
    ok(res, result.data, result.replay ? 200 : 201);
  }));
  router.patch("/produtos/:produtoBaseId/avancado", access(4), wrap(async (req, res) => {
    ok(res, await editarAvancado(db, session(req).contaId, numericId(req.params.produtoBaseId), null, req.body));
  }));
  router.patch("/produtos/:produtoBaseId/variantes/:varianteId/avancado", access(4), wrap(async (req, res) => {
    ok(res, await editarAvancado(db, session(req).contaId, numericId(req.params.produtoBaseId), numericId(req.params.varianteId), req.body));
  }));
  for (const tipo of ["venda", "os"] as const) {
    const path = tipo === "venda" ? "/vendas/:id/edicao" : "/servicos/ordens/:id/edicao";
    router.get(path, access(2), wrap(async (req, res) => {
      const result = await carregarEdicao(db, session(req).contaId, numericId(req.params.id), tipo);
      assertEditorScope(session(req), tipo, result.registro as { vendedorId?: number | null });
      ok(res, result);
    }));
    router.patch(path, access(2), wrap(async (req, res) => { ok(res, await editarOperacao(db, session(req), numericId(req.params.id), tipo, req.body, editPorts)); }));
  }
  // Safe details projection: unlike the legacy Operador:true include, no user
  // password hash, token version or administrative flags can enter this DTO.
  router.get("/servicos/ordens/:id", access(2), wrap(async (req, res) => {
    const registro = await db.ordensServico.findFirst({ where: { id: numericId(req.params.id), contaId: session(req).contaId }, include: {
      ItensOrdensServico: true, ComboSaidas: { include: { componentes: true } }, Cliente: true, CobrancasFinanceiras: true,
      MensagensInteracoesOrdemServico: { orderBy: { data: "asc" }, include: { Autor: { select: { id: true, nome: true } } } },
      Operador: { select: { id: true, nome: true } },
    } });
    if (!registro) throw new ModoFacilError(404, "operation_not_found", "OS não encontrada."); ok(res, registro);
  }));
  router.patch("/pessoas/:id/avancado", access(2), wrap(async (req, res) => { ok(res, await editarPessoaAvancado(db, session(req).contaId, numericId(req.params.id), req.body)); }));
  router.patch("/servicos/:id/avancado", access(4), wrap(async (req, res) => { ok(res, await editarServicoAvancado(db, session(req).contaId, numericId(req.params.id), req.body)); }));
  router.patch("/servicos/:id/basico", access(2), wrap(async (req, res) => { ok(res, await editarServicoBasico(db, session(req).contaId, numericId(req.params.id), req.body)); }));
  router.patch("/servicos/:id/status", access(2), validate(z.object({ status: z.boolean() }).strict()), wrap(async (req, res) => { ok(res, await editarServicoAvancado(db, session(req).contaId, numericId(req.params.id), req.body)); }));
  router.patch("/financeiro/contas/:id", access(4), wrap(async (req, res) => { ok(res, await editarContaFinanceira(db, session(req).contaId, numericId(req.params.id), req.body)); }));
  router.get("/configuracoes/operacionais", access(4), wrap(async (req, res) => { ok(res, await getParametrosOperacionais(db, session(req).contaId)); }));
  router.get("/configuracoes/empresa", access(4), wrap(async (req, res) => { ok(res, await getEmpresa(db, session(req).contaId)); }));
  router.patch("/configuracoes/empresa", access(4), wrap(async (req, res) => {
    const data = await editarEmpresa(db, session(req).contaId, req.body);
    try { await notify(session(req).contaId, session(req).userId); } catch { console.warn("[modofacil] Empresa persistida; atualização de sessão pendente."); }
    ok(res, data);
  }));
  router.patch("/configuracoes/operacionais", access(4), wrap(async (req, res) => {
    const data = await editarParametrosOperacionais(db, session(req).contaId, req.body);
    try { await notify(session(req).contaId, session(req).userId); } catch { console.warn("[modofacil] Configuração persistida; atualização de sessão pendente."); }
    ok(res, data);
  }));
  return router;
}
