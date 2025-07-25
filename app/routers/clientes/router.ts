import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { select2Clientes } from "../../controllers/clientes/hooks";
import { tableClientes } from "../../controllers/clientes/table";

const routerClientes = Router();

routerClientes.get("/select2/lista", authenticateJWT, select2Clientes);
routerClientes.get("/getDataTable", authenticateJWT, tableClientes);

export {
    routerClientes
}