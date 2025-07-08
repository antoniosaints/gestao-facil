import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { deleteVenda, getResumoVendasMensalChart, getVenda, getVendas, saveVenda } from "../../controllers/vendas/gerenciar";
import { gerarCupomNaoFiscal } from "../../controllers/vendas/cupomNaoFiscal";
import { gerarCupomPdf } from "../../controllers/vendas/cupomNaoFiscalPdf";

const routerVendas = Router();

routerVendas.post("/criar", authenticateJWT, saveVenda);
routerVendas.get("/:id", authenticateJWT, getVenda);
routerVendas.delete("/:id", authenticateJWT, deleteVenda);
routerVendas.get("/cupom/:id", authenticateJWT, gerarCupomNaoFiscal);
routerVendas.get("/cupom-pdf/:id", authenticateJWT, gerarCupomPdf);
routerVendas.get("/lista/geral", authenticateJWT, getVendas);
routerVendas.get("/resumo/mensal", authenticateJWT, getResumoVendasMensalChart);

export {
    routerVendas
}