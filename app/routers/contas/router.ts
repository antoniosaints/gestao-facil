import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { assinaturaConta } from "../../controllers/administracao/contas";
import { checkarPermissao, createSubscription, verificarAssinatura } from "../../controllers/asaas/assinatura";
import { criarLinkAssinatura } from "../../controllers/mercadopago/gateway";
import { getPaymentMercadoPago } from "../../controllers/mercadopago/webhook";
import { atualizarDadosConta, criarConta, dadosConta, infosConta } from "../../controllers/contas/cadastro";
import { saveParametros } from "../../controllers/contas/parametros";

const routerContas = Router();

routerContas.get("/assinatura/status", authenticateJWT, assinaturaConta);
routerContas.get("/assinatura", authenticateJWT, createSubscription);
routerContas.post("/verificarPermissao", authenticateJWT, checkarPermissao);
routerContas.post("/verificarAssinatura", authenticateJWT, verificarAssinatura);
routerContas.get("/assinatura/mercadopago", authenticateJWT, criarLinkAssinatura);
routerContas.get("/assinatura/mercadopago/getPagamento", authenticateJWT, getPaymentMercadoPago);
routerContas.post("/cadastro", criarConta);
routerContas.post("/atualizar", authenticateJWT, atualizarDadosConta);
routerContas.get("/infos", authenticateJWT, dadosConta);
routerContas.get("/detalhes", authenticateJWT, infosConta);
routerContas.post("/parametros", authenticateJWT, saveParametros);

export {
    routerContas
}