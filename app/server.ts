import express from "express";
import path from "path";
import http from "http";
import cors from "cors";
import { RouterMain } from "./routers/api";
import { engine } from "express-handlebars";
import { configOptions } from "./config/handlebars";
import { initSocket } from "./utils/socket";
import { env } from "./utils/dotenv";
import { routerPrinter } from "./routers/impressao/router";

const app = express();
const server = http.createServer(app);

app.engine("hbs", engine(configOptions));
app.set("view engine", "hbs");

app.use(
  cors({
    origin: "*",
  })
);

app.use("/api/printer", routerPrinter);

app.use(express.static(path.join(__dirname, "../public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(RouterMain);

initSocket(server);

server.listen(env.PORT, () => console.log(`Servidor rodando na porta ${env.PORT} 🎯🚀`));
