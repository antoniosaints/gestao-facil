import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import {
  addComandaItens,
  cancelarComanda,
  createComanda,
  deleteComanda,
  faturarComanda,
  fecharComanda,
  gerarComandaComprovante,
  getComanda,
  getComandaConfiguracao,
  listComandas,
  removeComandaItem,
  saveComandaConfiguracao,
  updateComandaItem,
} from "../../controllers/comandas/comandas";

const routerComandas = Router();

routerComandas.use(authenticateJWT);

routerComandas.get("/", listComandas);
routerComandas.get("/configuracao", getComandaConfiguracao);
routerComandas.post("/configuracao", saveComandaConfiguracao);
routerComandas.post("/", createComanda);
routerComandas.get("/:id", getComanda);
routerComandas.delete("/:id", deleteComanda);
routerComandas.post("/:id/itens", addComandaItens);
routerComandas.put("/:id/itens/:itemId", updateComandaItem);
routerComandas.delete("/:id/itens/:itemId", removeComandaItem);
routerComandas.post("/:id/fechar", fecharComanda);
routerComandas.post("/:id/faturar", faturarComanda);
routerComandas.post("/:id/cancelar", cancelarComanda);
routerComandas.get("/:id/comprovante", gerarComandaComprovante);

export { routerComandas };
