import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { blockImpersonation } from "../../middlewares/blockImpersonation";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { getResumoFaturasAssinantesSistema } from "../../controllers/gerencia/dashboard";
import { tableContasGerencia } from "../../controllers/gerencia/contasTable";

const routerGerencia = Router();

routerGerencia.use(authenticateJWT, blockImpersonation, requireSuperAdmin);

routerGerencia.get("/dashboard/resumoFaturas", getResumoFaturasAssinantesSistema);
routerGerencia.get("/contaSistema/datatable", tableContasGerencia);

export {
    routerGerencia
}
