import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { deleteVenda, getResumoVendasMensalChart, getVenda, saveVenda } from "../../controllers/vendas/gerenciar";

const routerVendas = Router();

routerVendas.post("/criar", authenticateJWT, saveVenda);
routerVendas.get("/:id", authenticateJWT, getVenda);
routerVendas.delete("/:id", authenticateJWT, deleteVenda);
routerVendas.get("/resumo/mensal", authenticateJWT, getResumoVendasMensalChart);

export {
    routerVendas
}