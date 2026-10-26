// Only real Express handlers are registered on the new router. No fabricated
// request/response, no duplicated financial/stock effect in the adapter.
export { getProduto, getProdutoVariante, getVariantesProduto, getCategoriasProduto, saveCategoriaProduto, uploadVarianteImagem, deleteVarianteImagem } from "../../controllers/produtos/produtos";
export { tableMovimentacoes, resumoMovimentacoes } from "../../controllers/produtos/movimentacoes";
export { tableProdutos } from "../../controllers/produtos/table";
export { select2Produtos } from "../../controllers/produtos/hooks";
export { tableVendas } from "../../controllers/vendas/table";
export { getVenda, saveVenda, efetivarVenda, estornarVenda } from "../../controllers/vendas/gerenciar";
export { getContextoCaixa, abrirCaixa, fecharCaixa, movimentarCaixa, finalizarVendaPdv } from "../../controllers/vendas/caixas";
export { getDashboardFinanceiroVisaoGeral } from "../../controllers/financeiro/dashboard";
export { tableFinanceiro } from "../../controllers/financeiro/table";
export { getLacamento, pagarParcela, estornarParcela, updateLancamentoBasico } from "../../controllers/financeiro/gerenciar";
export { listCategorias } from "../../controllers/financeiro/categorias";
export { listContasFinanceiro } from "../../controllers/financeiro/contas";
export { tableServico, getServico, saveServico } from "../../controllers/servicos/servicos";
export { tableOrdensServico } from "../../controllers/servicos/table_ordens";
export { buscarOrdemDetalhe, saveOrdemServico, efetivarOrdemServico, estornarOrdemServico } from "../../controllers/servicos/ordens";
export { getCliente, saveCliente } from "../../controllers/clientes/clientes";
export { tableClientes } from "../../controllers/clientes/table";
