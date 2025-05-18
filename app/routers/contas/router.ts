import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { assinaturaConta } from "../../controllers/administracao/contas";

const routerContas = Router();

routerContas.get("/assinatura/status", authenticateJWT, assinaturaConta);

export {
    routerContas
}