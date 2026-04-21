import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { getDashboardMain } from "../../controllers/administracao/dashboard";
import { manageAssinanteAdmin, tableAssinantesAdmin } from "../../controllers/administracao/assinantes";
import { getDashboardFaturasAdmin, manageFaturaAdmin, tableFaturasAdmin } from "../../controllers/administracao/faturas";
import {
  getAdminGatewayConfig,
  saveAdminGatewayConfig,
} from "../../controllers/administracao/configuracoes";

const routerAdminMain = Router();

routerAdminMain.get("/resumo", authenticateJWT, getDashboardMain);
routerAdminMain.get("/assinantes", authenticateJWT, tableAssinantesAdmin);
routerAdminMain.post("/assinantes/:id/controle", authenticateJWT, manageAssinanteAdmin);
routerAdminMain.get("/faturas", authenticateJWT, tableFaturasAdmin);
routerAdminMain.post("/faturas/:id/controle", authenticateJWT, manageFaturaAdmin);
routerAdminMain.get("/faturas/dashboard", authenticateJWT, getDashboardFaturasAdmin);
routerAdminMain.get("/configuracoes/gateway", authenticateJWT, getAdminGatewayConfig);
routerAdminMain.post("/configuracoes/gateway", authenticateJWT, saveAdminGatewayConfig);

export {
    routerAdminMain
}
