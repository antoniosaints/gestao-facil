import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { blockImpersonation } from "../../middlewares/blockImpersonation";
import { getDashboardMain } from "../../controllers/administracao/dashboard";
import {
  iniciarAcessoSuporte,
  listarAcessosSuporte,
  revogarAcessoSuporte,
} from "../../controllers/administracao/suporte";
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
import { createFaturaManualAdmin, deleteFaturaAdmin, getDashboardFaturasAdmin, manageFaturaAdmin, select2ContasAdmin, tableFaturasAdmin } from "../../controllers/administracao/faturas";
import {
  getAdminGatewayConfig,
  getAdminIndicacaoConfig,
  saveAdminGatewayConfig,
  saveAdminIndicacaoConfig,
} from "../../controllers/administracao/configuracoes";
import {
  getAdminSiteConfig,
  saveAdminSiteConfig,
} from "../../controllers/site/site";
import {
  listModulosAdmin,
  updateModuloAdmin,
} from "../../controllers/administracao/modulos";
import {
  createChaveIaAdmin,
  createModeloIaAdmin,
  deleteChaveIaAdmin,
  deleteModeloIaAdmin,
  getCoreConfigIaAdmin,
  listChavesIaAdmin,
  listModelosIaAdmin,
  saveCoreConfigIaAdmin,
  getUsageIaAdmin,
  updateChaveIaAdmin,
  updateModeloIaAdmin,
} from "../../controllers/administracao/inteligencia";
import {
  archiveInformativoAdmin,
  createInformativoAdmin,
  listInformativosAdmin,
  publishInformativoAdmin,
  resolveInformativoAdmin,
  updateInformativoAdmin,
} from "../../controllers/administracao/informativos";

const routerAdminMain = Router();

// Aplicado a todo o /api/admin de uma vez: a política aqui é "só superadmin, nunca
// em sessão de suporte", e repetir os middlewares rota a rota faz a checagem falhar
// por omissão assim que alguém adicionar um endpoint novo.
routerAdminMain.use(authenticateJWT, blockImpersonation);

routerAdminMain.get("/resumo", getDashboardMain);
routerAdminMain.get("/assinantes", tableAssinantesAdmin);
routerAdminMain.post("/assinantes", createAssinanteAdmin);
routerAdminMain.delete("/assinantes/:id", deleteAssinanteAdmin);
routerAdminMain.get("/financeiro/painel", getFinanceiroPainelAdmin);
routerAdminMain.get("/monitoramento", getMonitoramentoAdmin);
routerAdminMain.get("/informativos", listInformativosAdmin);
routerAdminMain.post("/informativos", createInformativoAdmin);
routerAdminMain.put("/informativos/:id", updateInformativoAdmin);
routerAdminMain.post("/informativos/:id/publicar", publishInformativoAdmin);
routerAdminMain.post("/informativos/:id/resolver", resolveInformativoAdmin);
routerAdminMain.post("/informativos/:id/arquivar", archiveInformativoAdmin);
routerAdminMain.post("/assinantes/:id/controle", manageAssinanteAdmin);
routerAdminMain.post("/assinantes/:id/reset-senha-root", resetRootPasswordAdmin);
routerAdminMain.get("/assinantes/:id/apps", listAssinanteAppsAdmin);
routerAdminMain.post("/assinantes/:id/apps/:moduleId", toggleAssinanteAppAdmin);

// Acesso de suporte às contas dos assinantes (impersonation auditada).
// O encerramento fica em /api/auth/suporte/encerrar: aqui o blockImpersonation
// barraria a própria sessão de suporte de se encerrar.
routerAdminMain.post("/assinantes/:id/acessar", iniciarAcessoSuporte);
routerAdminMain.get("/suporte/acessos", listarAcessosSuporte);
routerAdminMain.post("/suporte/acessos/:id/revogar", revogarAcessoSuporte);
routerAdminMain.get("/faturas", tableFaturasAdmin);
routerAdminMain.get("/faturas/contas/select2", select2ContasAdmin);
routerAdminMain.post("/faturas/manual", createFaturaManualAdmin);
routerAdminMain.post("/faturas/:id/controle", manageFaturaAdmin);
routerAdminMain.delete("/faturas/:id", deleteFaturaAdmin);
routerAdminMain.get("/faturas/dashboard", getDashboardFaturasAdmin);
routerAdminMain.get("/configuracoes/gateway", getAdminGatewayConfig);
routerAdminMain.post("/configuracoes/gateway", saveAdminGatewayConfig);
routerAdminMain.get("/modulos", listModulosAdmin);
routerAdminMain.patch("/modulos/:id", updateModuloAdmin);
routerAdminMain.get("/configuracoes/indicacao", getAdminIndicacaoConfig);
routerAdminMain.post("/configuracoes/indicacao", saveAdminIndicacaoConfig);
routerAdminMain.get("/site", getAdminSiteConfig);
routerAdminMain.put("/site", saveAdminSiteConfig);

// Inteligência (IA) — chaves de API e modelos da plataforma (super admin)
routerAdminMain.get("/ia/chaves", listChavesIaAdmin);
routerAdminMain.post("/ia/chaves", createChaveIaAdmin);
routerAdminMain.put("/ia/chaves/:id", updateChaveIaAdmin);
routerAdminMain.delete("/ia/chaves/:id", deleteChaveIaAdmin);
routerAdminMain.get("/ia/modelos", listModelosIaAdmin);
routerAdminMain.post("/ia/modelos", createModeloIaAdmin);
routerAdminMain.put("/ia/modelos/:id", updateModeloIaAdmin);
routerAdminMain.delete("/ia/modelos/:id", deleteModeloIaAdmin);
routerAdminMain.get("/ia/core", getCoreConfigIaAdmin);
routerAdminMain.put("/ia/core", saveCoreConfigIaAdmin);
routerAdminMain.get("/ia/uso", getUsageIaAdmin);

export {
    routerAdminMain
}
