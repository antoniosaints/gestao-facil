import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { saveVenda } from "../../controllers/vendas/gerenciar";

const routerVendas = Router();

routerVendas.post("/criar", authenticateJWT, saveVenda);

export {
    routerVendas
}