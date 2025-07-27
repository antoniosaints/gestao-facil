import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { criarLancamento, deletarLancamento, estornarParcela, gerarReciboPdf, listarParcelas, pagarMultiplasParcelas, pagarParcela } from "../../controllers/financeiro/gerenciar";
import { tableLancamentos } from "../../controllers/financeiro/table";
import { graficoByCategoria, graficoDespesasPorCategoria, graficoReceitaDespesaMensal, graficoSaldoMensal } from "../../controllers/financeiro/graficos";
import { getDRELancamentos, getDRELancamentosPDF, getLancamentosPorCategoria } from "../../controllers/financeiro/relatorios";

const routerLancamentos = Router();

routerLancamentos.post("/", authenticateJWT, criarLancamento);
routerLancamentos.get("/getDataTable", authenticateJWT, tableLancamentos);
routerLancamentos.post("/parcelas/:id/pagar", authenticateJWT, pagarParcela);
routerLancamentos.post("/parcelas/pagar-multiplas", authenticateJWT, pagarMultiplasParcelas);
routerLancamentos.post("/parcelas/:id/estornar", authenticateJWT, estornarParcela);
routerLancamentos.post("/parcelas/cliente", authenticateJWT, listarParcelas);
routerLancamentos.post("/parcelas/:id/recibo", authenticateJWT, gerarReciboPdf);
routerLancamentos.delete("/:id", authenticateJWT, deletarLancamento);
// graficos
routerLancamentos.get("/graficos/categorias", authenticateJWT, graficoByCategoria);
routerLancamentos.get("/graficos/despesas-categoria", authenticateJWT, graficoDespesasPorCategoria);
routerLancamentos.get("/graficos/saldo-mensal", authenticateJWT, graficoSaldoMensal);
routerLancamentos.get("/graficos/receita-despesa-mensal", authenticateJWT, graficoReceitaDespesaMensal);
// relatorios
routerLancamentos.get("/relatorios/dre-pdf", authenticateJWT, getDRELancamentosPDF);
routerLancamentos.get("/relatorios/dre", authenticateJWT, getDRELancamentos);
routerLancamentos.get("/relatorios/categoria", authenticateJWT, getLancamentosPorCategoria);

export {
    routerLancamentos
}