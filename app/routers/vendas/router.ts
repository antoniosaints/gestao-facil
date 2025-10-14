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
import { getLucroPorVendas } from "../../controllers/vendas/relatorios";
import { tableVendas } from "../../controllers/vendas/table";
import { ListagemMobileVendas } from "../../controllers/vendas/mobile";
import { ResumoVendasController } from "../../controllers/vendas/resumo";
import { getFaturamentoDiario, getFaturamentoMensal, getPorMetodoPagamento, getPorStatusVenda, getTopProdutos } from "../../controllers/vendas/graficos";

const routerVendas = Router();

routerVendas.get("/", authenticateJWT, tableVendas);
routerVendas.get("/mobile/data", authenticateJWT, ListagemMobileVendas);
routerVendas.get("/resumo/dashboard", authenticateJWT, ResumoVendasController.getResumo);
routerVendas.post("/criar", authenticateJWT, saveVenda);
routerVendas.get("/lista/geral", authenticateJWT, getVendas);
routerVendas.get("/resumo/mensal", authenticateJWT, getResumoVendasMensalChart);
routerVendas.get("/resumo/lucro", authenticateJWT, getLucroPorVendas);
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
