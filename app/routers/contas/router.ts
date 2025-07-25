import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { assinaturaConta } from "../../controllers/administracao/contas";
import { createSubscription } from "../../controllers/asaas/assinatura";
import { criarLinkAssinatura } from "../../controllers/mercadopago/gateway";

const routerContas = Router();

routerContas.get("/assinatura/status", authenticateJWT, assinaturaConta);
routerContas.get("/assinatura", authenticateJWT, createSubscription);
routerContas.post("/assinatura/mercadopago", authenticateJWT, criarLinkAssinatura);

export {
    routerContas
}