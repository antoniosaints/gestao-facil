import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { deletarMeta, getMeta, listarMetas, resumoMetas, salvarMeta } from "../../controllers/metas/metas";

const routerMetas = Router();

routerMetas.use(authenticateJWT);
routerMetas.get("/", listarMetas);
routerMetas.get("/resumo", resumoMetas);
routerMetas.get("/:id", getMeta);
routerMetas.post("/", salvarMeta);
routerMetas.delete("/:id", deletarMeta);

export { routerMetas };
