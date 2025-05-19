import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { select2Clientes } from "../../controllers/clientes/hooks";

const routerClientes = Router();

routerClientes.get("/select2/lista", authenticateJWT, select2Clientes);

export {
    routerClientes
}