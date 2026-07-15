import { Router } from "express";
import multer from "multer";
import { authenticateJWT } from "../../middlewares/auth";
import { createAgent, listAgents, removeAgent, updateAgent } from "../../controllers/whatsapp/agentes";
import { getPainelAtendimento } from "../../controllers/whatsapp/painel";
import { getRelatorioAtendimentos, getRelatorioAtendimentosResumo } from "../../controllers/whatsapp/relatorios";
import {
  attendConversation,
  configureInstanceWebhooks,
  createCardSubscription,
  createInstance,
  createInstanceAuto,
  createPixPayment,
  getInstanceWebhooks,
  getMessageMedia,
  instanceAction,
  listContacts,
  listConversations,
  listConversationSales,
  listInstanceWebhookEvents,
  listInstances,
  listMessages,
  markConversationAsRead,
  sendConversationSale,
  receivePaymentWebhook,
  receiveWebhook,
  removeContact,
  removeConversation,
  select2Contacts,
  removeInstance,
  removePayment,
  sendAudioMessage,
  sendContactMessage,
  sendImageMessage,
  sendLocationMessage,
  sendMessage,
  startConversation,
  updateContact,
  updateConversation,
  updateInstance,
  updateInstanceAtendimento,
} from "../../controllers/whatsapp/whatsapp";

const routerWhatsapp = Router();
// Upload de mídia (imagem/áudio) em memória; o processamento (scale down / transcode) fica no
// service. Limite defensivo de 25MB.
const uploadMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

routerWhatsapp.post("/webhooks/:instanceId", receiveWebhook);
routerWhatsapp.post("/payments/webhooks/:instanceId", receivePaymentWebhook);

routerWhatsapp.use(authenticateJWT);
routerWhatsapp.get("/instances", listInstances);
routerWhatsapp.post("/instances", createInstance);
routerWhatsapp.post("/instances/generate", createInstanceAuto);
routerWhatsapp.put("/instances/:id", updateInstance);
routerWhatsapp.patch("/instances/:id/atendimento", updateInstanceAtendimento);
routerWhatsapp.delete("/instances/:id", removeInstance);
routerWhatsapp.get("/instances/:id/webhooks", getInstanceWebhooks);
routerWhatsapp.get("/instances/:id/eventos", listInstanceWebhookEvents);
routerWhatsapp.post("/instances/:id/webhooks", configureInstanceWebhooks);
routerWhatsapp.post("/instances/:id/payments/pix", createPixPayment);
routerWhatsapp.post("/instances/:id/payments/card-subscription", createCardSubscription);
routerWhatsapp.delete("/instances/:id/payments/:paymentId", removePayment);
routerWhatsapp.post("/instances/:id/:action", instanceAction);

routerWhatsapp.get("/contatos", listContacts);
routerWhatsapp.get("/contatos/select2", select2Contacts);
routerWhatsapp.patch("/contatos/:id", updateContact);
routerWhatsapp.delete("/contatos/:id", removeContact);

routerWhatsapp.get("/agentes", listAgents);
routerWhatsapp.post("/agentes", createAgent);
routerWhatsapp.put("/agentes/:id", updateAgent);
routerWhatsapp.delete("/agentes/:id", removeAgent);

routerWhatsapp.get("/graficos/painel", getPainelAtendimento);
routerWhatsapp.get("/relatorios/atendimentos", getRelatorioAtendimentos);
routerWhatsapp.get("/relatorios/atendimentos/resumo", getRelatorioAtendimentosResumo);

routerWhatsapp.get("/conversas", listConversations);
routerWhatsapp.post("/conversas/iniciar", startConversation);
routerWhatsapp.delete("/conversas/:id", removeConversation);
routerWhatsapp.get("/conversas/:id/mensagens", listMessages);
routerWhatsapp.get("/messages/:id/media", getMessageMedia);
routerWhatsapp.post("/conversas/:id/mensagens", sendMessage);
routerWhatsapp.post("/conversas/:id/mensagens/localizacao", sendLocationMessage);
routerWhatsapp.post("/conversas/:id/mensagens/contato", sendContactMessage);
routerWhatsapp.post("/conversas/:id/mensagens/imagem", uploadMedia.single("file"), sendImageMessage);
routerWhatsapp.post("/conversas/:id/mensagens/audio", uploadMedia.single("file"), sendAudioMessage);
routerWhatsapp.patch("/conversas/:id", updateConversation);
routerWhatsapp.post("/conversas/:id/atender", attendConversation);
routerWhatsapp.get("/conversas/:id/ferramentas/vendas", listConversationSales);
routerWhatsapp.post("/conversas/:id/ferramentas/vendas", sendConversationSale);
routerWhatsapp.post("/conversas/:id/read", markConversationAsRead);

export { routerWhatsapp };
