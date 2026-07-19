import { Router } from "express";
import {
  dismissInformativo,
  listInformativosAtivos,
  markInformativoRead,
} from "../../controllers/administracao/informativos";
import { authenticateJWT } from "../../middlewares/auth";

const routerInformativos = Router();

routerInformativos.use(authenticateJWT);
routerInformativos.get("/ativos", listInformativosAtivos);
routerInformativos.post("/:id/leitura", markInformativoRead);
routerInformativos.post("/:id/dispensar", dismissInformativo);

export { routerInformativos };
