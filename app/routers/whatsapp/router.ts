import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import {
  configureInstanceWebhooks,
  createInstance,
  getInstanceWebhooks,
  instanceAction,
  listConversations,
  listInstances,
  listMessages,
  markConversationAsRead,
  receiveWebhook,
  sendMessage,
  updateConversation,
  updateInstance,
} from "../../controllers/whatsapp/whatsapp";

const routerWhatsapp = Router();

routerWhatsapp.post("/webhooks/:instanceId", receiveWebhook);

routerWhatsapp.use(authenticateJWT);
routerWhatsapp.get("/instances", listInstances);
routerWhatsapp.post("/instances", createInstance);
routerWhatsapp.put("/instances/:id", updateInstance);
routerWhatsapp.get("/instances/:id/webhooks", getInstanceWebhooks);
routerWhatsapp.post("/instances/:id/webhooks", configureInstanceWebhooks);
routerWhatsapp.post("/instances/:id/:action", instanceAction);

routerWhatsapp.get("/conversas", listConversations);
routerWhatsapp.get("/conversas/:id/mensagens", listMessages);
routerWhatsapp.post("/conversas/:id/mensagens", sendMessage);
routerWhatsapp.patch("/conversas/:id", updateConversation);
routerWhatsapp.post("/conversas/:id/read", markConversationAsRead);

export { routerWhatsapp };
