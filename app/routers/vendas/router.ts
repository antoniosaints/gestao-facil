import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { deleteVenda, efetivarVenda, estornarVenda, getResumoVendasMensalChart, getVenda, getVendas, saveVenda } from "../../controllers/vendas/gerenciar";
import { gerarCupomNaoFiscal } from "../../controllers/vendas/cupomNaoFiscal";
import { gerarCupomPdf } from "../../controllers/vendas/cupomNaoFiscalPdf";
import { getLucroPorVendas } from "../../controllers/vendas/relatorios";
import { tableVendas } from "../../controllers/vendas/table";
import { ListagemMobileVendas } from "../../controllers/vendas/mobile";

const routerVendas = Router();

routerVendas.get("/", authenticateJWT, tableVendas);
routerVendas.get("/mobile/data", authenticateJWT, ListagemMobileVendas);
routerVendas.post("/criar", authenticateJWT, saveVenda);
routerVendas.get("/:id", authenticateJWT, getVenda);
routerVendas.delete("/:id", authenticateJWT, deleteVenda);
routerVendas.get("/cupom/:id", authenticateJWT, gerarCupomNaoFiscal);
routerVendas.get("/cupom-pdf/:id", authenticateJWT, gerarCupomPdf);
routerVendas.get("/lista/geral", authenticateJWT, getVendas);
routerVendas.get("/resumo/mensal", authenticateJWT, getResumoVendasMensalChart);
routerVendas.get("/resumo/lucro", authenticateJWT, getLucroPorVendas);
routerVendas.post("/efetivar/:id", authenticateJWT, efetivarVenda);
routerVendas.get("/estornar/:id", authenticateJWT, estornarVenda);

export {
    routerVendas
}