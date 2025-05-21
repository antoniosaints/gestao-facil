import express from "express";
import cors from "cors";
import { checkAuth, login, verify } from "./controllers/auth/login";
import { authenticateJWT } from "./middlewares/auth";
import { tableUsuarios } from "./controllers/administracao/usuarios";
import {
  sendNotification,
  subscribe,
  unsubscribe,
} from "./controllers/notifications/push";
import webRouter from "./routers/web";
import path from "node:path";
import { tableVendas } from "./controllers/vendas/table";
import { resumoDashboard } from "./controllers/dashboard/resumo";
import { webhookAsaasCheck } from "./controllers/asaas/webhook";
import { RouterMain } from "./routers/api";
import { select2Usuarios } from "./controllers/administracao/hooks";
import { engine } from "express-handlebars";

const app = express();

app.engine(
  "hbs",
  engine({
    extname: "hbs",
    defaultLayout: false,
    helpers: {
      or: (a: any, b: any) => a || b,
      formatMoney: (valor: number) => {
        return new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
          minimumFractionDigits: 2,
        }).format(valor);
      },
    },
  })
);
app.set("view engine", "hbs");

app.use(cors());

// Servir arquivos estáticos (HTMX, JS, CSS, etc.)
app.use(express.static(path.join(__dirname, "../public")));
app.use(webRouter);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(RouterMain);

app.post("/login", login);
app.get("/auth/check", checkAuth);
app.get("/auth/verify", verify);
app.get("/usuarios", authenticateJWT, tableUsuarios);
app.get("/usuarios/select2/lista", authenticateJWT, select2Usuarios);

// Rotas webhook
app.post("/asaas/webhook", webhookAsaasCheck);
// Rotas Dashboard
app.get("/dashboard/resumo", authenticateJWT, resumoDashboard);

//  Rotas Vendas
app.get("/vendas", authenticateJWT, tableVendas);

// Rotas Push
app.post("/subscribe", authenticateJWT, subscribe);
app.post("/unsubscribe", authenticateJWT, unsubscribe);
app.post("/send-notification", authenticateJWT, sendNotification);

app.listen(3000, () => console.log("Rodando na porta 3000"));
