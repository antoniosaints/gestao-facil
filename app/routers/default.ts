import { Router } from "express";
import { checkAuth, login, renewToken, verify, verificarSenha } from "../controllers/auth/login";
import { encerrarAcessoSuporte } from "../controllers/administracao/suporte";
import { authenticateJWT } from "../middlewares/auth";
import { resumoDashboard } from "../controllers/dashboard/resumo";
import { webhookAsaasCheck } from "../controllers/asaas/webhook";
import { webhookAbacatePay } from "../controllers/abacatepay/webhook";
import { webhookMercadoPago, webhookMercadoPagoCobrancas } from "../controllers/mercadopago/webhook";
import { sendNotification, subscribe, unsubscribe } from "../controllers/notifications/push";
import { getPublicSiteConfig } from "../controllers/site/site";
import { env } from "../utils/dotenv";

const routerDefault = Router();

routerDefault.get("/", (req, res) => {
  res.json({
    message: "API Gestão Fácil - V1",
    frontend: env.BASE_URL_FRONTEND,
    version: "1.0.0",
    status: 200,
    date: new Date(),
  });
});

routerDefault.post("/api/login", login);
routerDefault.get("/api/dashboard/resumo", authenticateJWT, resumoDashboard);
routerDefault.get("/api/site/config", getPublicSiteConfig);

routerDefault.get("/api/auth/check", authenticateJWT, checkAuth);
routerDefault.get("/api/auth/verify", authenticateJWT, verify);
routerDefault.get("/api/auth/renew", authenticateJWT, renewToken);
routerDefault.post("/api/auth/senha", authenticateJWT, verificarSenha);
routerDefault.post("/api/auth/suporte/encerrar", authenticateJWT, encerrarAcessoSuporte);

// Rotas webhook
routerDefault.post("/asaas/webhook", webhookAsaasCheck);
routerDefault.post("/abacatepay/webhook", webhookAbacatePay);
routerDefault.post("/mercadopago/webhook", webhookMercadoPago);
routerDefault.post("/mercadopago/webhook/cobrancas", webhookMercadoPagoCobrancas);
// Rotas Push
routerDefault.post("/api/subscribe", authenticateJWT, subscribe);
routerDefault.post("/api/unsubscribe", authenticateJWT, unsubscribe);
routerDefault.post("/send-notification", authenticateJWT, sendNotification);

export {
    routerDefault
}
