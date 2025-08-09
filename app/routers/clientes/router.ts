import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { select2Clientes } from "../../controllers/clientes/hooks";
import { tableClientes } from "../../controllers/clientes/table";
import { getCliente, saveCliente, deleteCliente } from "../../controllers/clientes/clientes";

const routerClientes = Router();

routerClientes.get("/select2/lista", authenticateJWT, select2Clientes);
routerClientes.get("/getDataTable", authenticateJWT, tableClientes);
routerClientes.get("/:id", authenticateJWT, getCliente);
routerClientes.post("/", authenticateJWT, saveCliente);
routerClientes.delete("/:id", authenticateJWT, deleteCliente);

export {
    routerClientes
}