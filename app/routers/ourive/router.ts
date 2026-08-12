import { Router, type RequestHandler } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { requireOuriveAccess, requireOuriveModule } from "../../middlewares/ouriveAccess";
import { addExtraCost, addPiecePhoto, cancelOrder, createOrder, createStage, currentOuriveAccess, dashboard, decideBudgetInternal, decideBudgetPublic, deliverOrder, getConfig, getOrder, listCommissions, listOrders, listSpecialties, listUsers, publicBudget, report, returnMaterial, saveBudget, saveConfig, saveSpecialty, saveUser, sendBudget, settleCommission, startProduction, updateStage } from "../../controllers/ourive/ourive";

const use = (handler: unknown) => handler as RequestHandler;
export const routerOurive = Router();

routerOurive.get("/publico/orcamentos/:token", use(publicBudget));
routerOurive.post("/publico/orcamentos/:token/decisao", use(decideBudgetPublic));

routerOurive.use(authenticateJWT);
routerOurive.get("/acesso", requireOuriveModule(), use(currentOuriveAccess));
routerOurive.get("/painel", requireOuriveAccess("VISUALIZAR"), use(dashboard));
routerOurive.get("/relatorios", requireOuriveAccess("RELATORIOS"), use(report));
routerOurive.get("/comissoes", requireOuriveAccess("VISUALIZAR"), use(listCommissions));
routerOurive.post("/comissoes/:id/quitar", requireOuriveAccess("FINANCEIRO"), use(settleCommission));
routerOurive.get("/especialidades", requireOuriveAccess("VISUALIZAR"), use(listSpecialties));
routerOurive.post("/especialidades", requireOuriveAccess("EQUIPE"), use(saveSpecialty));
routerOurive.get("/equipe", requireOuriveAccess("EQUIPE"), use(listUsers));
routerOurive.put("/equipe/:usuarioId", requireOuriveAccess("EQUIPE"), use(saveUser));
routerOurive.get("/configuracao", requireOuriveAccess("CONFIGURAR"), use(getConfig));
routerOurive.put("/configuracao", requireOuriveAccess("CONFIGURAR"), use(saveConfig));
routerOurive.get("/ordens", requireOuriveAccess("VISUALIZAR"), use(listOrders));
routerOurive.post("/ordens", requireOuriveAccess("RECEBER"), use(createOrder));
routerOurive.get("/ordens/:id", requireOuriveAccess("VISUALIZAR"), use(getOrder));
routerOurive.put("/ordens/:id/orcamento", requireOuriveAccess("ORCAMENTO"), use(saveBudget));
routerOurive.post("/ordens/:id/orcamento/enviar", requireOuriveAccess("ORCAMENTO"), use(sendBudget));
routerOurive.post("/ordens/:id/orcamento/decisao", requireOuriveAccess("ORCAMENTO"), use(decideBudgetInternal));
routerOurive.post("/ordens/:id/etapas", requireOuriveAccess("PRODUCAO"), use(createStage));
routerOurive.post("/ordens/:id/producao/iniciar", requireOuriveAccess("PRODUCAO"), use(startProduction));
routerOurive.post("/ordens/:id/entregar", requireOuriveAccess("ENTREGAR"), use(deliverOrder));
routerOurive.post("/ordens/:id/cancelar", requireOuriveAccess("ORCAMENTO"), use(cancelOrder));
routerOurive.post("/ordens/:id/custos-extras", requireOuriveAccess("PRODUCAO"), use(addExtraCost));
routerOurive.post("/pecas/:pecaId/fotos", requireOuriveAccess("RECEBER"), use(addPiecePhoto));
routerOurive.patch("/etapas/:etapaId", requireOuriveModule(), use(updateStage));
routerOurive.post("/materiais/:materialId/devolver", requireOuriveAccess("PRODUCAO"), use(returnMaterial));
