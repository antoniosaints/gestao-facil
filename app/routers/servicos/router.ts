import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { deleteServico, getServico, getServicos, mobileServico, saveServico, tableServico } from "../../controllers/servicos/servicos";
import { select2Servicos } from "../../controllers/servicos/hooks";
import { deleteOrdemServico, saveOrdemServico } from "../../controllers/servicos/ordens";

const routerServicos = Router();

//API
routerServicos.get("/", authenticateJWT, getServicos);
routerServicos.get("/select2", authenticateJWT, select2Servicos);
routerServicos.post("/", authenticateJWT, saveServico);
routerServicos.delete("/:id", authenticateJWT, deleteServico);
routerServicos.get("/:id", authenticateJWT, getServico);
//Ordens de serviço
routerServicos.get("/ordens", authenticateJWT, getServicos);
routerServicos.post("/ordens", authenticateJWT, saveOrdemServico);
routerServicos.delete("/ordens/:id", authenticateJWT, deleteOrdemServico);
routerServicos.get("/ordens/:id", authenticateJWT, getServico);
//Tabela e Mobile
routerServicos.get("/lista/tabela", authenticateJWT, tableServico);
routerServicos.get("/lista/mobile", authenticateJWT, mobileServico);

export { routerServicos };
