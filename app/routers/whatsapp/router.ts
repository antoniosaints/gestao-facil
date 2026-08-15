import { Router } from "express";
import multer from "multer";
import { authenticateJWT } from "../../middlewares/auth";
import { coreIaGate } from "../../middlewares/coreIaGate";
import { atendimentoAccess } from "../../middlewares/atendimentoAccess";
import { createAgent, listAgents, removeAgent, testAgent, updateAgent } from "../../controllers/whatsapp/agentes";
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
  retryInstanceWebhookEvent,
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
  syncAllInstances,
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
routerWhatsapp.use("/agentes", coreIaGate);
routerWhatsapp.get("/instances", listInstances);
routerWhatsapp.post("/instances", createInstance);
// Registrada antes da catch-all `/instances/:id/:action` para não ser capturada por ela.
routerWhatsapp.post("/instances/sync-all", syncAllInstances);
routerWhatsapp.post("/instances/generate", createInstanceAuto);
routerWhatsapp.put("/instances/:id", updateInstance);
routerWhatsapp.patch("/instances/:id/atendimento", atendimentoAccess, updateInstanceAtendimento);
routerWhatsapp.delete("/instances/:id", removeInstance);
routerWhatsapp.get("/instances/:id/webhooks", getInstanceWebhooks);
routerWhatsapp.get("/instances/:id/eventos", atendimentoAccess, listInstanceWebhookEvents);
routerWhatsapp.post("/instances/:id/eventos/:eventoId/retry", atendimentoAccess, retryInstanceWebhookEvent);
routerWhatsapp.post("/instances/:id/webhooks", configureInstanceWebhooks);
routerWhatsapp.post("/instances/:id/payments/pix", createPixPayment);
routerWhatsapp.post("/instances/:id/payments/card-subscription", createCardSubscription);
routerWhatsapp.delete("/instances/:id/payments/:paymentId", removePayment);
routerWhatsapp.post("/instances/:id/:action", instanceAction);

routerWhatsapp.get("/contatos", atendimentoAccess, listContacts);
routerWhatsapp.get("/contatos/select2", atendimentoAccess, select2Contacts);
routerWhatsapp.patch("/contatos/:id", atendimentoAccess, updateContact);
routerWhatsapp.delete("/contatos/:id", atendimentoAccess, removeContact);

routerWhatsapp.use("/agentes", atendimentoAccess);
routerWhatsapp.get("/agentes", listAgents);
routerWhatsapp.post("/agentes", createAgent);
routerWhatsapp.put("/agentes/:id", updateAgent);
routerWhatsapp.post("/agentes/:id/teste", testAgent);
routerWhatsapp.delete("/agentes/:id", removeAgent);

routerWhatsapp.get("/graficos/painel", atendimentoAccess, getPainelAtendimento);
routerWhatsapp.get("/relatorios/atendimentos", atendimentoAccess, getRelatorioAtendimentos);
routerWhatsapp.get("/relatorios/atendimentos/resumo", atendimentoAccess, getRelatorioAtendimentosResumo);

routerWhatsapp.use("/conversas", atendimentoAccess);
routerWhatsapp.use("/messages", atendimentoAccess);
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
