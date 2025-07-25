import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { assinaturaConta } from "../../controllers/administracao/contas";
import { createSubscription } from "../../controllers/asaas/assinatura";
import { criarLinkAssinatura } from "../../controllers/mercadopago/gateway";
import { getPaymentMercadoPago } from "../../controllers/mercadopago/webhook";

const routerContas = Router();

routerContas.get("/assinatura/status", authenticateJWT, assinaturaConta);
routerContas.get("/assinatura", authenticateJWT, createSubscription);
routerContas.get("/assinatura/mercadopago", authenticateJWT, criarLinkAssinatura);
routerContas.get("/assinatura/mercadopago/getPagamento", authenticateJWT, getPaymentMercadoPago);

export {
    routerContas
}