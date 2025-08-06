import { Router } from "express";
import { authenticateJWT } from "../../../middlewares/auth";
import { deleteUsuario, getUsuario, saveUsuario } from "../../../controllers/administracao/usuarios";

const routerUsuarios = Router();

routerUsuarios.post("/salvar", authenticateJWT, saveUsuario);
routerUsuarios.get("/get/:id", authenticateJWT, getUsuario);
routerUsuarios.delete("/delete/:id", authenticateJWT, deleteUsuario);

export {
    routerUsuarios
}