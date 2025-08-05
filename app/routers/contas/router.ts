import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { assinaturaConta } from "../../controllers/administracao/contas";
import { createSubscription } from "../../controllers/asaas/assinatura";
import { criarLinkAssinatura } from "../../controllers/mercadopago/gateway";
import { getPaymentMercadoPago } from "../../controllers/mercadopago/webhook";
import { criarConta, dadosConta } from "../../controllers/contas/cadastro";

const routerContas = Router();

routerContas.get("/assinatura/status", authenticateJWT, assinaturaConta);
routerContas.get("/assinatura", authenticateJWT, createSubscription);
routerContas.get("/assinatura/mercadopago", authenticateJWT, criarLinkAssinatura);
routerContas.get("/assinatura/mercadopago/getPagamento", authenticateJWT, getPaymentMercadoPago);
routerContas.post("/cadastro", criarConta);
routerContas.get("/infos", authenticateJWT, dadosConta);

export {
    routerContas
}