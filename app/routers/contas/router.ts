import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { assinaturaConta } from "../../controllers/administracao/contas";
import {
  checkarPermissao,
  createSubscription,
  verificarAssinatura,
} from "../../controllers/asaas/assinatura";
import { criarCheckoutAssinaturaConta } from "../../controllers/contas/assinaturaGateway";
import { getPaymentMercadoPago } from "../../controllers/mercadopago/webhook";
import {
  atualizarDadosConta,
  criarConta,
  dadosConta,
  infosConta,
} from "../../controllers/contas/cadastro";
import {
  activateStoreModule,
  cancelStoreModule,
  listStoreModules,
} from "../../controllers/contas/store";
import {
  gerenciarLinkPublicoCliente,
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
routerContas.get(
  "/assinatura/mercadopago/getPagamento",
  authenticateJWT,
  getPaymentMercadoPago
);
routerContas.post("/cadastro", criarConta);
routerContas.post("/atualizar", authenticateJWT, atualizarDadosConta);
routerContas.get("/infos", authenticateJWT, dadosConta);
routerContas.get("/detalhes", authenticateJWT, infosConta);
routerContas.post("/parametros", authenticateJWT, saveParametros);
routerContas.get("/parametros", authenticateJWT, getParametros);
routerContas.post("/parametros/linkpublico", authenticateJWT, gerenciarLinkPublicoCliente);
routerContas.get("/store/modulos", authenticateJWT, listStoreModules);
routerContas.post("/store/modulos/:id/ativar", authenticateJWT, activateStoreModule);
routerContas.post("/store/modulos/:id/cancelar", authenticateJWT, cancelStoreModule);

routerContas.get("/publico/detalhes", getDetalhePublico);
routerContas.post("/publico/salvarCliente", savePublicoCliente);

export { routerContas };
