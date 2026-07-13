import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { getDashboardMain } from "../../controllers/administracao/dashboard";
import {
  createAssinanteAdmin,
  deleteAssinanteAdmin,
  listAssinanteAppsAdmin,
  manageAssinanteAdmin,
  resetRootPasswordAdmin,
  tableAssinantesAdmin,
  toggleAssinanteAppAdmin,
} from "../../controllers/administracao/assinantes";
import { getFinanceiroPainelAdmin } from "../../controllers/administracao/financeiro";
import { getMonitoramentoAdmin } from "../../controllers/administracao/monitoramento";
import { deleteFaturaAdmin, getDashboardFaturasAdmin, manageFaturaAdmin, tableFaturasAdmin } from "../../controllers/administracao/faturas";
import {
  getAdminGatewayConfig,
  getAdminIndicacaoConfig,
  saveAdminGatewayConfig,
  saveAdminIndicacaoConfig,
} from "../../controllers/administracao/configuracoes";
import {
  listModulosAdmin,
  updateModuloAdmin,
} from "../../controllers/administracao/modulos";
import {
  createChaveIaAdmin,
  createModeloIaAdmin,
  deleteChaveIaAdmin,
  deleteModeloIaAdmin,
  listChavesIaAdmin,
  listModelosIaAdmin,
  updateChaveIaAdmin,
  updateModeloIaAdmin,
} from "../../controllers/administracao/inteligencia";

const routerAdminMain = Router();

routerAdminMain.get("/resumo", authenticateJWT, getDashboardMain);
routerAdminMain.get("/assinantes", authenticateJWT, tableAssinantesAdmin);
routerAdminMain.post("/assinantes", authenticateJWT, createAssinanteAdmin);
routerAdminMain.delete("/assinantes/:id", authenticateJWT, deleteAssinanteAdmin);
routerAdminMain.get("/financeiro/painel", authenticateJWT, getFinanceiroPainelAdmin);
routerAdminMain.get("/monitoramento", authenticateJWT, getMonitoramentoAdmin);
routerAdminMain.post("/assinantes/:id/controle", authenticateJWT, manageAssinanteAdmin);
routerAdminMain.post("/assinantes/:id/reset-senha-root", authenticateJWT, resetRootPasswordAdmin);
routerAdminMain.get("/assinantes/:id/apps", authenticateJWT, listAssinanteAppsAdmin);
routerAdminMain.post("/assinantes/:id/apps/:moduleId", authenticateJWT, toggleAssinanteAppAdmin);
routerAdminMain.get("/faturas", authenticateJWT, tableFaturasAdmin);
routerAdminMain.post("/faturas/:id/controle", authenticateJWT, manageFaturaAdmin);
routerAdminMain.delete("/faturas/:id", authenticateJWT, deleteFaturaAdmin);
routerAdminMain.get("/faturas/dashboard", authenticateJWT, getDashboardFaturasAdmin);
routerAdminMain.get("/configuracoes/gateway", authenticateJWT, getAdminGatewayConfig);
routerAdminMain.post("/configuracoes/gateway", authenticateJWT, saveAdminGatewayConfig);
routerAdminMain.get("/modulos", authenticateJWT, listModulosAdmin);
routerAdminMain.patch("/modulos/:id", authenticateJWT, updateModuloAdmin);
routerAdminMain.get("/configuracoes/indicacao", authenticateJWT, getAdminIndicacaoConfig);
routerAdminMain.post("/configuracoes/indicacao", authenticateJWT, saveAdminIndicacaoConfig);

// Inteligência (IA) — chaves de API e modelos da plataforma (super admin)
routerAdminMain.get("/ia/chaves", authenticateJWT, listChavesIaAdmin);
routerAdminMain.post("/ia/chaves", authenticateJWT, createChaveIaAdmin);
routerAdminMain.put("/ia/chaves/:id", authenticateJWT, updateChaveIaAdmin);
routerAdminMain.delete("/ia/chaves/:id", authenticateJWT, deleteChaveIaAdmin);
routerAdminMain.get("/ia/modelos", authenticateJWT, listModelosIaAdmin);
routerAdminMain.post("/ia/modelos", authenticateJWT, createModeloIaAdmin);
routerAdminMain.put("/ia/modelos/:id", authenticateJWT, updateModeloIaAdmin);
routerAdminMain.delete("/ia/modelos/:id", authenticateJWT, deleteModeloIaAdmin);

export {
    routerAdminMain
}
