import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { assinaturaConta } from "../../controllers/administracao/contas";
import {
  checkarPermissao,
  createSubscription,
  verificarAssinatura,
} from "../../controllers/asaas/assinatura";
import { criarCheckoutAssinaturaConta, renovarAssinaturaGratis } from "../../controllers/contas/assinaturaGateway";
import { getPaymentMercadoPago } from "../../controllers/mercadopago/webhook";
import {
  desconectarMercadoPago,
  iniciarConexaoMercadoPago,
  statusIntegracaoMercadoPago,
} from "../../controllers/mercadopago/oauth";
import {
  atualizarDadosConta,
  criarConta,
  dadosConta,
  getMinhaIndicacao,
  infosConta,
} from "../../controllers/contas/cadastro";
import {
  activateStoreModule,
  cancelStoreModule,
  listStoreModules,
} from "../../controllers/contas/store";
import {
  concluirTourOnboarding,
  gerenciarLinkPublicoCliente,
  getWhatsappNotificationInstances,
    getDetalhePublico,
  getParametros,
  saveParametros,
  savePublicoCliente,
} from "../../controllers/contas/parametros";

const routerContas = Router();

routerContas.get("/assinatura/status", authenticateJWT, assinaturaConta);
routerContas.get("/assinatura", authenticateJWT, createSubscription);
routerContas.post("/verificarPermissao", authenticateJWT, checkarPermissao);
routerContas.post("/verificarAssinatura", authenticateJWT, verificarAssinatura);
routerContas.get(
  "/assinatura/checkout",
  authenticateJWT,
  criarCheckoutAssinaturaConta,
);
routerContas.get(
  "/assinatura/mercadopago",
  authenticateJWT,
  criarCheckoutAssinaturaConta,
);
routerContas.post(
  "/assinatura/renovar-gratis",
  authenticateJWT,
  renovarAssinaturaGratis,
);
routerContas.get(
  "/assinatura/mercadopago/getPagamento",
  authenticateJWT,
  getPaymentMercadoPago
);
routerContas.post("/cadastro", criarConta);
routerContas.post("/atualizar", authenticateJWT, atualizarDadosConta);
routerContas.get("/infos", authenticateJWT, dadosConta);
routerContas.get("/indicacao", authenticateJWT, getMinhaIndicacao);
routerContas.get("/detalhes", authenticateJWT, infosConta);
routerContas.post("/parametros", authenticateJWT, saveParametros);
routerContas.get("/parametros", authenticateJWT, getParametros);
routerContas.patch("/onboarding/tour", authenticateJWT, concluirTourOnboarding);
routerContas.get("/parametros/whatsapp-instancias", authenticateJWT, getWhatsappNotificationInstances);
routerContas.post("/parametros/linkpublico", authenticateJWT, gerenciarLinkPublicoCliente);
routerContas.get(
  "/integracoes/mercadopago/conectar",
  authenticateJWT,
  iniciarConexaoMercadoPago,
);
routerContas.get(
  "/integracoes/mercadopago/status",
  authenticateJWT,
  statusIntegracaoMercadoPago,
);
routerContas.post(
  "/integracoes/mercadopago/desconectar",
  authenticateJWT,
  desconectarMercadoPago,
);
routerContas.get("/store/modulos", authenticateJWT, listStoreModules);
routerContas.post("/store/modulos/:id/ativar", authenticateJWT, activateStoreModule);
routerContas.post("/store/modulos/:id/cancelar", authenticateJWT, cancelStoreModule);

routerContas.get("/publico/detalhes", getDetalhePublico);
routerContas.post("/publico/salvarCliente", savePublicoCliente);

export { routerContas };
