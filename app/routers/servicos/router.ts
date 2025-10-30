import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { deleteServico, getServico, getServicos, mobileServico, saveServico, tableServico } from "../../controllers/servicos/servicos";
import { select2Servicos } from "../../controllers/servicos/hooks";
import { buscarOrdem, buscarOrdens, deleteOrdemServico, saveOrdemServico } from "../../controllers/servicos/ordens";
import { ListagemMobileOrdens, tableOrdensServico } from "../../controllers/servicos/table_ordens";
import { gerarPdfOS } from "../../controllers/servicos/ordens_relatorios";

const routerServicos = Router();

//API
routerServicos.get("/", authenticateJWT, getServicos);
routerServicos.get("/select2", authenticateJWT, select2Servicos);
routerServicos.post("/", authenticateJWT, saveServico);
routerServicos.delete("/:id", authenticateJWT, deleteServico);
//Ordens de serviço
routerServicos.get("/ordens", authenticateJWT, buscarOrdens);
routerServicos.post("/ordens", authenticateJWT, saveOrdemServico);
routerServicos.delete("/ordens/:id", authenticateJWT, deleteOrdemServico);
routerServicos.get("/ordens/:id", authenticateJWT, buscarOrdem);
routerServicos.get("/ordens/relatorio/:id", authenticateJWT, gerarPdfOS);
//Tabela e Mobile
routerServicos.get("/lista/tabela", authenticateJWT, tableServico);
routerServicos.get("/lista/mobile", authenticateJWT, mobileServico);
routerServicos.get("/lista/ordens/tabela", authenticateJWT, tableOrdensServico);
routerServicos.get("/lista/ordens/mobile", authenticateJWT, ListagemMobileOrdens);

// Buscar serviço
routerServicos.get("/:id", authenticateJWT, getServico);
export { routerServicos };
