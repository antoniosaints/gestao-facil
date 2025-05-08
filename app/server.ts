import express from "express";
import cors from "cors";
import { tableProdutos } from "./controllers/produtos/table";
import { checkAuth, login, verify } from "./controllers/auth/login";
import { authenticateJWT } from "./middlewares/auth";
import { deleteProduto, getProduto, saveProduto } from "./controllers/produtos/produtos";
import { tableUsuarios } from "./controllers/administracao/usuarios";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.post("/login", login);
app.get("/produtos", authenticateJWT, tableProdutos);
app.get("/usuarios", authenticateJWT, tableUsuarios);
app.get("/produtos/:id", authenticateJWT, getProduto);
app.delete("/produtos/:id", authenticateJWT, deleteProduto);
app.post("/produtos", authenticateJWT, saveProduto);
app.get("/auth/check", checkAuth);
app.get("/auth/verify", verify);

app.listen(3000, () => console.log("Rodando na porta 3000"));
