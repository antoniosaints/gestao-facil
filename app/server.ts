import express from "express";
import cors from "cors";
import { tableProdutos } from "./controllers/produtos/table";
import { checkAuth, login, verify } from "./controllers/auth/login";
import { authenticateJWT } from "./middlewares/auth";
import { deleteProduto, getProduto, reposicaoProduto, saveProduto } from "./controllers/produtos/produtos";
import { tableUsuarios } from "./controllers/administracao/usuarios";
import { relatorioProdutoMovimentacoes, relatorioProdutos } from "./controllers/produtos/relatorios";
import { sendNotification, subscribe, unsubscribe } from "./controllers/notifications/push";
import webRouter from "./routers/web";

const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(webRouter);

app.post("/login", login);
app.get("/auth/check", checkAuth);
app.get("/auth/verify", verify);
app.get("/usuarios", authenticateJWT, tableUsuarios);

// Rotas Produtos
app.get("/produtos/relatorio", authenticateJWT, relatorioProdutos);
app.get("/produtos/relatorio/reposicao/:id", authenticateJWT, relatorioProdutoMovimentacoes);
app.get("/produtos", authenticateJWT, tableProdutos);
app.get("/produtos/:id", authenticateJWT, getProduto);
app.post("/produtos/reposicao", authenticateJWT, reposicaoProduto);
app.post("/produtos", authenticateJWT, saveProduto);
app.delete("/produtos/:id", authenticateJWT, deleteProduto);

// Rotas Push
app.post("/subscribe", authenticateJWT, subscribe);
app.post("/unsubscribe", unsubscribe);
app.post("/send-notification", sendNotification);

app.listen(3000, () => console.log("Rodando na porta 3000"));
