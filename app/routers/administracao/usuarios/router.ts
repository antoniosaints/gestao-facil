import { Router } from "express";
import { authenticateJWT } from "../../../middlewares/auth";
import { deleteUsuario, getUsuario, listagemMobileUsuarios, saveUsuario, tableUsuarios } from "../../../controllers/administracao/usuarios";
import { select2Usuarios } from "../../../controllers/administracao/hooks";

const routerUsuarios = Router();

routerUsuarios.get("/", authenticateJWT, tableUsuarios);
routerUsuarios.post("/salvar", authenticateJWT, saveUsuario);
routerUsuarios.get("/get/:id", authenticateJWT, getUsuario);
routerUsuarios.get("/select2", authenticateJWT, select2Usuarios);
routerUsuarios.delete("/delete/:id", authenticateJWT, deleteUsuario);
routerUsuarios.get("/mobile/data", authenticateJWT, listagemMobileUsuarios);

export {
    routerUsuarios
}