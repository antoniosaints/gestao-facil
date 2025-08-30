import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { criarLancamento, deletarLancamento, estornarParcela, gerarReciboPdf, listarParcelas, pagarMultiplasParcelas, pagarParcela } from "../../controllers/financeiro/gerenciar";
import { tableLancamentos } from "../../controllers/financeiro/table";
import { graficoByCategoria, graficoByContaFinanceira, graficoByStatus, graficoDespesasPorCategoria, graficoReceitaDespesaMensal, graficoSaldoMensal } from "../../controllers/financeiro/graficos";
import { getDRELancamentos, getDRELancamentosPDF, getDRELancamentosPDFV2, getLancamentosPorCategoria, getLancamentosPorConta, getLancamentosPorPagamento, getLancamentosPorStatus, getLancamentosTotaisGerais, getMediaMensalLancamentos, getParcelasAtrasadas, getResumoPorCliente } from "../../controllers/financeiro/relatorios";
import { ListagemMobileLancamentos } from "../../controllers/financeiro/mobile";
import { deleteCategoria, saveCategoria, select2Categorias } from "../../controllers/financeiro/categorias";
import { deleteContaFinanceiro, saveContaFinanceiro } from "../../controllers/financeiro/contas";
import { select2ContasFinanceiras } from "../../controllers/financeiro/hooks";

const routerLancamentos = Router();

routerLancamentos.post("/", authenticateJWT, criarLancamento);
routerLancamentos.get("/getDataTable", authenticateJWT, tableLancamentos);
routerLancamentos.get("/mobile/data", authenticateJWT, ListagemMobileLancamentos);
routerLancamentos.post("/parcelas/:id/pagar", authenticateJWT, pagarParcela);
routerLancamentos.post("/parcelas/pagar-multiplas", authenticateJWT, pagarMultiplasParcelas);
routerLancamentos.post("/parcelas/:id/estornar", authenticateJWT, estornarParcela);
routerLancamentos.post("/parcelas/cliente", authenticateJWT, listarParcelas);
routerLancamentos.post("/parcelas/:id/recibo", authenticateJWT, gerarReciboPdf);
routerLancamentos.delete("/:id", authenticateJWT, deletarLancamento);
// graficos
routerLancamentos.get("/graficos/categorias", authenticateJWT, graficoByCategoria);
routerLancamentos.get("/graficos/contas", authenticateJWT, graficoByContaFinanceira);
routerLancamentos.get("/graficos/despesas-categoria", authenticateJWT, graficoDespesasPorCategoria);
routerLancamentos.get("/graficos/status", authenticateJWT, graficoByStatus);
routerLancamentos.get("/graficos/saldo-mensal", authenticateJWT, graficoSaldoMensal);
routerLancamentos.get("/graficos/receita-despesa-mensal", authenticateJWT, graficoReceitaDespesaMensal);
// relatorios
routerLancamentos.get("/relatorios/dre-pdf", authenticateJWT, getDRELancamentosPDF);
routerLancamentos.get("/relatorios/dre-pdf-2", authenticateJWT, getDRELancamentosPDFV2);
routerLancamentos.get("/relatorios/dre", authenticateJWT, getDRELancamentos);
routerLancamentos.get("/relatorios/categoria", authenticateJWT, getLancamentosPorCategoria);
routerLancamentos.get("/relatorios/parcelas-atrasadas", authenticateJWT, getParcelasAtrasadas);
routerLancamentos.get("/relatorios/resumo-clientes", authenticateJWT, getResumoPorCliente);
routerLancamentos.get("/relatorios/media-mensal", authenticateJWT, getMediaMensalLancamentos);
routerLancamentos.get("/relatorios/valor-conta", authenticateJWT, getLancamentosPorConta);
routerLancamentos.get("/relatorios/valor-status", authenticateJWT, getLancamentosPorStatus);
routerLancamentos.get("/relatorios/valor-pagamento", authenticateJWT, getLancamentosPorPagamento);
routerLancamentos.get("/relatorios/totais", authenticateJWT, getLancamentosTotaisGerais);
// Categorias
routerLancamentos.get("/categorias/select2", authenticateJWT, select2Categorias);
routerLancamentos.delete("/categorias/:id", authenticateJWT, deleteCategoria);
routerLancamentos.post("/categorias", authenticateJWT, saveCategoria);
// Contas
routerLancamentos.get("/contas/select2", authenticateJWT, select2ContasFinanceiras);
routerLancamentos.delete("/contas/:id", authenticateJWT, deleteContaFinanceiro);
routerLancamentos.post("/contas", authenticateJWT, saveContaFinanceiro);

export {
    routerLancamentos
}