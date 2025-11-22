import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { getDashboardMain } from "../../controllers/administracao/dashboard";

const routerAdminMain = Router();

routerAdminMain.get("/resumo", authenticateJWT, getDashboardMain);

export {
    routerAdminMain
}