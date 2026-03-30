import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import {
  deleteVenda,
  efetivarVenda,
  estornarVenda,
  getResumoVendasMensalChart,
  getVenda,
  getVendas,
  saveVenda,
} from "../../controllers/vendas/gerenciar";
import { gerarCupomNaoFiscal } from "../../controllers/vendas/cupomNaoFiscal";
import { gerarCupomPdf } from "../../controllers/vendas/cupomNaoFiscalPdf";
import { getLucroPorVendas, getResumoVendasPDF } from "../../controllers/vendas/relatorios";
import { tableVendas } from "../../controllers/vendas/table";
import { ListagemMobileVendas } from "../../controllers/vendas/mobile";
import { ResumoVendasController } from "../../controllers/vendas/resumo";
import { getFaturamentoDiario, getFaturamentoMensal, getPorMetodoPagamento, getPorStatusVenda, getTopProdutos } from "../../controllers/vendas/graficos";
import { addItemComanda, checkoutComanda, deleteComanda, getComanda, listComandas, removeItemComanda, saveComanda } from "../../controllers/vendas/comandas";

const routerVendas = Router();

routerVendas.get("/", authenticateJWT, tableVendas);
routerVendas.get("/mobile/data", authenticateJWT, ListagemMobileVendas);
routerVendas.get("/comandas", authenticateJWT, listComandas);
routerVendas.get("/comandas/:id", authenticateJWT, getComanda);
routerVendas.post("/comandas", authenticateJWT, saveComanda);
routerVendas.delete("/comandas/:id", authenticateJWT, deleteComanda);
routerVendas.post("/comandas/:id/itens", authenticateJWT, addItemComanda);
routerVendas.delete("/comandas/:id/itens/:itemId", authenticateJWT, removeItemComanda);
routerVendas.post("/comandas/:id/checkout", authenticateJWT, checkoutComanda);
routerVendas.get("/resumo/dashboard", authenticateJWT, ResumoVendasController.getResumo);
routerVendas.post("/criar", authenticateJWT, saveVenda);
routerVendas.get("/lista/geral", authenticateJWT, getVendas);
routerVendas.get("/resumo/mensal", authenticateJWT, getResumoVendasMensalChart);
routerVendas.get("/resumo/lucro", authenticateJWT, getLucroPorVendas);
routerVendas.get("/relatorios/resumo-pdf", authenticateJWT, getResumoVendasPDF);
routerVendas.get("/cupom/:id", authenticateJWT, gerarCupomNaoFiscal);
routerVendas.get("/cupom-pdf/:id", authenticateJWT, gerarCupomPdf);
routerVendas.post("/efetivar/:id", authenticateJWT, efetivarVenda);
routerVendas.get("/estornar/:id", authenticateJWT, estornarVenda);
routerVendas.get("/:id", authenticateJWT, getVenda);
routerVendas.delete("/:id", authenticateJWT, deleteVenda);

//Graficos
routerVendas.get("/graficos/faturamento-diario", authenticateJWT, getFaturamentoDiario);
routerVendas.get("/graficos/faturamento-mensal", authenticateJWT, getFaturamentoMensal);
routerVendas.get("/graficos/metodo-pagamento", authenticateJWT, getPorMetodoPagamento);
routerVendas.get("/graficos/status-venda", authenticateJWT, getPorStatusVenda);
routerVendas.get("/graficos/top-produtos", authenticateJWT, getTopProdutos);

export { routerVendas };
