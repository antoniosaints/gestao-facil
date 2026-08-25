import { Router, type RequestHandler } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import {
  requireOuriveAccess,
  requireOuriveModule,
} from "../../middlewares/ouriveAccess";
import {
  addExtraCost,
  addPiecePhoto,
  cancelOrder,
  createOrder,
  createOurivePayment,
  createProLabore,
  createStage,
  currentOuriveAccess,
  dashboard,
  deleteOrder,
  decideBudgetInternal,
  decideBudgetPublic,
  deliverOrder,
  finalizeMaterial,
  finalizeProduction,
  fulfillPurchaseNeed,
  getConfig,
  getOrder,
  getOrderFinancial,
  listCommissions,
  listOrders,
  listLeftovers,
  listOurivePayments,
  listOuriveTransfers,
  listProLabore,
  listPurchaseNeeds,
  listSpecialties,
  listUsers,
  publicBudget,
  payProLabore,
  removePiecePhoto,
  report,
  returnMaterial,
  saveBudget,
  saveConfig,
  saveSpecialty,
  saveUser,
  sendBudget,
  settleCommission,
  startProduction,
  consolidateOrderFinancial,
  consolidateLeftover,
  reopenOrderFinancial,
  updateOrderFinancial,
  updateOrderStatus,
  updateStage,
} from "../../controllers/ourive/ourive";

const use = (handler: unknown) => handler as RequestHandler;
export const routerOurive = Router();

routerOurive.get("/publico/orcamentos/:token", use(publicBudget));
routerOurive.post(
  "/publico/orcamentos/:token/decisao",
  use(decideBudgetPublic),
);

routerOurive.use(authenticateJWT);
routerOurive.get("/acesso", requireOuriveModule(), use(currentOuriveAccess));
routerOurive.get("/painel", requireOuriveAccess("VISUALIZAR"), use(dashboard));
routerOurive.get("/relatorios", requireOuriveAccess("RELATORIOS"), use(report));
routerOurive.get("/repasses", requireOuriveAccess("PAGAMENTOS"), use(listOuriveTransfers));
routerOurive.get("/pagamentos", requireOuriveAccess("PAGAMENTOS"), use(listOurivePayments));
routerOurive.post("/pagamentos", requireOuriveAccess("PAGAMENTOS"), use(createOurivePayment));
routerOurive.get("/pro-labore", requireOuriveAccess("PROLABORE"), use(listProLabore));
routerOurive.post("/pro-labore", requireOuriveAccess("PROLABORE"), use(createProLabore));
routerOurive.post("/pro-labore/:id/pagar", requireOuriveAccess("PROLABORE"), use(payProLabore));
routerOurive.get(
  "/comissoes",
  requireOuriveAccess("VISUALIZAR"),
  use(listCommissions),
);
routerOurive.patch(
  "/ordens/:id/status",
  requireOuriveAccess("KANBAN"),
  use(updateOrderStatus),
);
routerOurive.get(
  "/ordens/:id/financeiro",
  requireOuriveAccess("FINANCEIRO"),
  use(getOrderFinancial),
);
routerOurive.patch(
  "/ordens/:id/financeiro",
  requireOuriveAccess("FINANCEIRO"),
  use(updateOrderFinancial),
);
routerOurive.post(
  "/ordens/:id/financeiro/consolidar",
  requireOuriveAccess("FINANCEIRO"),
  use(consolidateOrderFinancial),
);
routerOurive.post(
  "/ordens/:id/financeiro/reabrir",
  requireOuriveAccess("FINANCEIRO"),
  use(reopenOrderFinancial),
);
routerOurive.post(
  "/comissoes/:id/quitar",
  requireOuriveAccess("FINANCEIRO"),
  use(settleCommission),
);
routerOurive.get(
  "/especialidades",
  requireOuriveAccess("VISUALIZAR"),
  use(listSpecialties),
);
routerOurive.post(
  "/especialidades",
  requireOuriveAccess("EQUIPE"),
  use(saveSpecialty),
);
// A produção precisa consultar os responsáveis e especialidades para mostrar
// as etapas ao ourive. Apenas a edição de vínculos segue restrita a EQUIPE.
routerOurive.get("/equipe", requireOuriveAccess("VISUALIZAR"), use(listUsers));
routerOurive.put(
  "/equipe/:usuarioId",
  requireOuriveAccess("EQUIPE"),
  use(saveUser),
);
routerOurive.get(
  "/configuracao",
  requireOuriveAccess("CONFIGURAR"),
  use(getConfig),
);
routerOurive.put(
  "/configuracao",
  requireOuriveAccess("CONFIGURAR"),
  use(saveConfig),
);
routerOurive.get("/ordens", requireOuriveAccess("VISUALIZAR"), use(listOrders));
routerOurive.get(
  "/necessidades-compra",
  requireOuriveAccess("PRODUCAO"),
  use(listPurchaseNeeds),
);
routerOurive.get("/sobras", requireOuriveAccess("PRODUCAO"), use(listLeftovers));
routerOurive.post("/ordens", requireOuriveAccess("RECEBER"), use(createOrder));
routerOurive.delete(
  "/ordens/:id",
  requireOuriveAccess("CONFIGURAR"),
  use(deleteOrder),
);
routerOurive.get(
  "/ordens/:id",
  requireOuriveAccess("VISUALIZAR"),
  use(getOrder),
);
routerOurive.put(
  "/ordens/:id/orcamento",
  requireOuriveAccess("ORCAMENTO"),
  use(saveBudget),
);
routerOurive.post(
  "/ordens/:id/orcamento/enviar",
  requireOuriveAccess("ORCAMENTO"),
  use(sendBudget),
);
routerOurive.post(
  "/ordens/:id/orcamento/decisao",
  requireOuriveAccess("ORCAMENTO"),
  use(decideBudgetInternal),
);
routerOurive.post(
  "/ordens/:id/etapas",
  requireOuriveAccess("PRODUCAO"),
  use(createStage),
);
routerOurive.post(
  "/ordens/:id/producao/iniciar",
  requireOuriveAccess("PRODUCAO"),
  use(startProduction),
);
routerOurive.post(
  "/ordens/:id/producao/finalizar",
  requireOuriveAccess("PRODUCAO"),
  use(finalizeProduction),
);
routerOurive.post(
  "/ordens/:id/entregar",
  requireOuriveAccess("ENTREGAR"),
  use(deliverOrder),
);
routerOurive.post(
  "/ordens/:id/cancelar",
  requireOuriveAccess("ORCAMENTO"),
  use(cancelOrder),
);
routerOurive.post(
  "/ordens/:id/custos-extras",
  requireOuriveAccess("PRODUCAO"),
  use(addExtraCost),
);
routerOurive.post(
  "/pecas/:pecaId/fotos",
  requireOuriveAccess("RECEBER"),
  use(addPiecePhoto),
);
routerOurive.delete(
  "/pecas/fotos/:fotoId",
  requireOuriveAccess("RECEBER"),
  use(removePiecePhoto),
);
routerOurive.patch("/etapas/:etapaId", requireOuriveModule(), use(updateStage));
routerOurive.post(
  "/materiais/:materialId/devolver",
  requireOuriveAccess("PRODUCAO"),
  use(returnMaterial),
);
routerOurive.post(
  "/materiais/:materialId/finalizar",
  requireOuriveAccess("PRODUCAO"),
  use(finalizeMaterial),
);
routerOurive.post(
  "/necessidades-compra/:needId/atender",
  requireOuriveAccess("PRODUCAO"),
  use(fulfillPurchaseNeed),
);
routerOurive.post(
  "/sobras/:id/consolidar",
  requireOuriveAccess("PRODUCAO"),
  use(consolidateLeftover),
);
