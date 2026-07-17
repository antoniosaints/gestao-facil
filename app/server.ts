import express, { NextFunction, Request, Response } from "express";
import path from "path";
import http from "http";
import cors from "cors";
import { RouterMain } from "./routers/api";
import { initSocket } from "./utils/socket";
import { env } from "./utils/dotenv";
import { routerPrinter } from "./routers/impressao/router";

const app = express();
const server = http.createServer(app);
const JSON_BODY_LIMIT = "15mb";

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
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
app.use(
  express.json({
    limit: JSON_BODY_LIMIT,
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString("utf8");
    },
  })
);
app.use((err: any, _req: Request, res: Response, next: NextFunction): any => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({
      message: "Imagem muito grande para processar. Reduza a imagem ou envie uma versão menor.",
    });
  }
  return next(err);
});

app.use(RouterMain);
initSocket(server);

server.listen(env.PORT, () => console.log(`Servidor rodando na porta ${env.PORT} 🎯🚀`));
