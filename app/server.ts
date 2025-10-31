import express from "express";
import path from "path";
import http from "http";
import cors from "cors";
import { checkAuth, login, renewToken, verify } from "./controllers/auth/login";
import { authenticateJWT } from "./middlewares/auth";
import {
  sendNotification,
  subscribe,
  unsubscribe,
} from "./controllers/notifications/push";
import { resumoDashboard } from "./controllers/dashboard/resumo";
import { webhookAsaasCheck } from "./controllers/asaas/webhook";
import { RouterMain } from "./routers/api";
import { engine } from "express-handlebars";
import {
  webhookMercadoPago,
  webhookMercadoPagoCobrancas,
} from "./controllers/mercadopago/webhook";
import { configOptions } from "./config/handlebars";
import { initSocket } from "./utils/socket";
import { env } from "./utils/dotenv";

const app = express();
const server = http.createServer(app);

app.engine("hbs", engine(configOptions));
app.set("view engine", "hbs");

app.use(
  cors({
    origin: "*",
  })
);

// Servir arquivos estáticos (HTMX, JS, CSS, etc.)
app.use(express.static(path.join(__dirname, "../public")));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "API Gestão Fácil - V1",
    frontend: env.BASE_URL_FRONTEND,
    version: "1.0.0",
    status: 200,
    date: new Date(),
  });
});
app.use(RouterMain);

app.post("/api/login", login);
app.get("/api/dashboard/resumo", authenticateJWT, resumoDashboard);

app.get("/api/auth/check", authenticateJWT, checkAuth);
app.get("/api/auth/verify", authenticateJWT, verify);
app.get("/api/auth/renew", authenticateJWT, renewToken);

// Rotas webhook
app.post("/asaas/webhook", webhookAsaasCheck);
app.post("/mercadopago/webhook", webhookMercadoPago);
app.post("/mercadopago/webhook/cobrancas", webhookMercadoPagoCobrancas);
// Rotas Push
app.post("/api/subscribe", authenticateJWT, subscribe);
app.post("/api/unsubscribe", authenticateJWT, unsubscribe);
app.post("/send-notification", authenticateJWT, sendNotification);

initSocket(server);

server.listen(env.PORT, () => console.log(`Servidor rodando na porta ${env.PORT}`));
