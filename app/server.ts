import express from "express";
import path from "path";
import http from "http";
import cors from "cors";
import { RouterMain } from "./routers/api";
import { initSocket } from "./utils/socket";
import { env } from "./utils/dotenv";
import { routerPrinter } from "./routers/impressao/router";

const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const configured = env.LOJA_CORS_ALLOWLIST?.split(",").map((value) => value.trim().replace(/\/+$/, "")).filter(Boolean) ?? [];
      const allowed = new Set([env.BASE_URL_FRONTEND.replace(/\/+$/, ""), ...configured]);
      const normalizedOrigin = origin.replace(/\/+$/, "");
      return callback(allowed.has(normalizedOrigin) ? null : new Error("Origem não permitida pelo CORS"), allowed.has(normalizedOrigin));
    },
    credentials: true,
  })
);

app.use("/api/printer", routerPrinter);

app.use(express.static(path.join(__dirname, "../public")));
app.use(express.urlencoded({ extended: true }));
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString("utf8");
    },
  })
);

app.use(RouterMain);
initSocket(server);

server.listen(env.PORT, () => console.log(`Servidor rodando na porta ${env.PORT} 🎯🚀`));
