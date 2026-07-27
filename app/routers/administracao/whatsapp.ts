import { Router } from "express";
import {
  configureWhatsAppWebhooksAdmin,
  createWhatsAppCardAdmin,
  createWhatsAppPixAdmin,
  getWhatsAppWebhooksAdmin,
  listWhatsAppWebhookEventsAdmin,
  removeWhatsAppInstanceAdmin,
  removeWhatsAppPaymentAdmin,
  syncWhatsAppInstanceAdmin,
  tableWhatsAppInstancesAdmin,
  updateWhatsAppAtendimentoAdmin,
  updateWhatsAppInstanceAdmin,
  whatsappInstanceActionAdmin,
} from "../../controllers/administracao/whatsapp";

const routerAdminWhatsApp = Router();

routerAdminWhatsApp.get("/instances", tableWhatsAppInstancesAdmin);
routerAdminWhatsApp.post("/instances/:id/sync", syncWhatsAppInstanceAdmin);
routerAdminWhatsApp.put("/instances/:id", updateWhatsAppInstanceAdmin);
routerAdminWhatsApp.patch("/instances/:id/atendimento", updateWhatsAppAtendimentoAdmin);
routerAdminWhatsApp.delete("/instances/:id", removeWhatsAppInstanceAdmin);
routerAdminWhatsApp.get("/instances/:id/webhooks", getWhatsAppWebhooksAdmin);
routerAdminWhatsApp.post("/instances/:id/webhooks", configureWhatsAppWebhooksAdmin);
routerAdminWhatsApp.get("/instances/:id/eventos", listWhatsAppWebhookEventsAdmin);
routerAdminWhatsApp.post("/instances/:id/payments/pix", createWhatsAppPixAdmin);
routerAdminWhatsApp.post("/instances/:id/payments/card-subscription", createWhatsAppCardAdmin);
routerAdminWhatsApp.delete(
  "/instances/:id/payments/:paymentId",
  removeWhatsAppPaymentAdmin,
);
routerAdminWhatsApp.post("/instances/:id/:action", whatsappInstanceActionAdmin);

export { routerAdminWhatsApp };
