import { Router } from "express";
import { authenticateJWT } from "../../../middlewares/auth";
import { deleteUsuario, getUsuario, listagemMobileUsuarios, saveUsuario } from "../../../controllers/administracao/usuarios";

const routerUsuarios = Router();

routerUsuarios.post("/salvar", authenticateJWT, saveUsuario);
routerUsuarios.get("/get/:id", authenticateJWT, getUsuario);
routerUsuarios.delete("/delete/:id", authenticateJWT, deleteUsuario);
routerUsuarios.get("/mobile/data", authenticateJWT, listagemMobileUsuarios);

export {
    routerUsuarios
}