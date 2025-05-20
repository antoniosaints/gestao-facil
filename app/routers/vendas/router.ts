import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { deleteVenda, getVenda, saveVenda } from "../../controllers/vendas/gerenciar";

const routerVendas = Router();

routerVendas.post("/criar", authenticateJWT, saveVenda);
routerVendas.get("/:id", authenticateJWT, getVenda);
routerVendas.delete("/:id", authenticateJWT, deleteVenda);

export {
    routerVendas
}