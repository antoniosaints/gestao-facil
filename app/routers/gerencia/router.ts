import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { getResumoFaturasAssinantesSistema } from "../../controllers/gerencia/dashboard";
import { tableContasGerencia } from "../../controllers/gerencia/contasTable";

const routerGerencia = Router();

routerGerencia.get("/dashboard/resumoFaturas", authenticateJWT, getResumoFaturasAssinantesSistema);
routerGerencia.get("/contaSistema/datatable", authenticateJWT, tableContasGerencia);

export {
    routerGerencia
}