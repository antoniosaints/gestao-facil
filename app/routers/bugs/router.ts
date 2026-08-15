import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { criarRelatoBug, listarMeusRelatosBug } from "../../controllers/bugs/relatos";

const routerBugs = Router();

routerBugs.post("/", authenticateJWT, criarRelatoBug);
routerBugs.get("/meus", authenticateJWT, listarMeusRelatosBug);

export { routerBugs };
