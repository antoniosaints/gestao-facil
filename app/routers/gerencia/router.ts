import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { getResumoFaturasAssinantesSistema } from "../../controllers/gerencia/dashboard";

const routerGerencia = Router();

routerGerencia.get("/dashboard/resumoFaturas", authenticateJWT, getResumoFaturasAssinantesSistema);



export {
    routerGerencia
}