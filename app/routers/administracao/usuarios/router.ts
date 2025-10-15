import { Router } from "express";
import { authenticateJWT } from "../../../middlewares/auth";
import { deleteUsuario, getMinhaConexao, getUsuario, listagemMobileUsuarios, saveUsuario, tableUsuarios, toggleModeGerencial, updatePerfil } from "../../../controllers/administracao/usuarios";
import { select2Usuarios } from "../../../controllers/administracao/hooks";

const routerUsuarios = Router();

routerUsuarios.get("/", authenticateJWT, tableUsuarios);
routerUsuarios.get("/toggleModeGerencial", authenticateJWT, toggleModeGerencial);
routerUsuarios.post("/salvar", authenticateJWT, saveUsuario);
routerUsuarios.post("/updatePerfil", authenticateJWT, updatePerfil);
routerUsuarios.get("/select2", authenticateJWT, select2Usuarios);
routerUsuarios.get("/whoami", authenticateJWT, getMinhaConexao);
routerUsuarios.get("/get/:id", authenticateJWT, getUsuario);
routerUsuarios.delete("/delete/:id", authenticateJWT, deleteUsuario);
routerUsuarios.get("/mobile/data", authenticateJWT, listagemMobileUsuarios);

export {
    routerUsuarios
}