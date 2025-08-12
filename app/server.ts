import express from "express";
import cors from "cors";
import { checkAuth, login, verify } from "./controllers/auth/login";
import { authenticateJWT } from "./middlewares/auth";
import {
  sendNotification,
  subscribe,
  unsubscribe,
} from "./controllers/notifications/push";
import webRouter from "./routers/web";
import path from "node:path";
import { resumoDashboard } from "./controllers/dashboard/resumo";
import { webhookAsaasCheck } from "./controllers/asaas/webhook";
import { RouterMain } from "./routers/api";
import { engine } from "express-handlebars";
import { webhookMercadoPago } from "./controllers/mercadopago/webhook";
import { configOptions } from "./config/handlebars";

const app = express();

app.engine("hbs", engine(configOptions));
app.set("view engine", "hbs");

app.use(cors());

// Servir arquivos estáticos (HTMX, JS, CSS, etc.)
app.use(express.static(path.join(__dirname, "../public")));
app.use(webRouter);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(RouterMain);

app.post("/api/login", login);
app.get("/api/dashboard/resumo", authenticateJWT, resumoDashboard);

app.get("/auth/check", authenticateJWT, checkAuth);
app.get("/auth/verify", verify);

// Rotas webhook
app.post("/asaas/webhook", webhookAsaasCheck);
app.post("/mercadopago/webhook", webhookMercadoPago);
// Rotas Push
app.post("/subscribe", authenticateJWT, subscribe);
app.post("/unsubscribe", authenticateJWT, unsubscribe);
app.post("/send-notification", authenticateJWT, sendNotification);

app.listen(3000, () => console.log("Rodando na porta 3000"));
