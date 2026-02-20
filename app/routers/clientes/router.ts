import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { select2Clientes } from "../../controllers/clientes/hooks";
import { tableClientes } from "../../controllers/clientes/table";
import { getCliente, saveCliente, deleteCliente } from "../../controllers/clientes/clientes";
import { ListagemMobileClientes } from "../../controllers/clientes/mobile";
import { getClienteStats } from "../../controllers/clientes/estatisticas";

const routerClientes = Router();

routerClientes.get("/select2", authenticateJWT, select2Clientes);
routerClientes.get("/mobile", authenticateJWT, ListagemMobileClientes);
routerClientes.get("/getDataTable", authenticateJWT, tableClientes);
routerClientes.get("/:id/estatisticas", authenticateJWT, getClienteStats);
routerClientes.get("/:id", authenticateJWT, getCliente);
routerClientes.post("/", authenticateJWT, saveCliente);
routerClientes.delete("/:id", authenticateJWT, deleteCliente);

export {
    routerClientes
}