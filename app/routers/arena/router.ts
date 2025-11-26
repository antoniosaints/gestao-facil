import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import {
  createReserva,
  getReservas,
  getSlotsDisponiveis,
  getSlotsDisponiveisPublico,
} from "../../controllers/arena/reservas/gerenciar";
import {
  createQuadra,
  getQuadras,
  getQuadrasPublico,
} from "../../controllers/arena/quadras/gerenciar";
import { select2ArenaQuadras } from "../../controllers/arena/quadras/hooks";
import { ReservasChartsController } from "../../controllers/arena/reservas/graficos";
import { ListagemQuadras } from "../../controllers/arena/quadras/tabela";
import { ListagemReservas } from "../../controllers/arena/reservas/tabela";

const routerArena = Router();
const controller = new ReservasChartsController();

routerArena.get("/quadras", authenticateJWT, getQuadras);
routerArena.get("/quadras/tabela", authenticateJWT, ListagemQuadras);
routerArena.get("/quadras/publico/agendamento", getQuadrasPublico);
routerArena.post("/reservas/publico/horarios", getSlotsDisponiveisPublico);
routerArena.get("/quadras/select2", authenticateJWT, select2ArenaQuadras);
routerArena.get(
  "/quadras/:quadraId/disponiveis",
  authenticateJWT,
  getSlotsDisponiveis
);
routerArena.get("/reservas", authenticateJWT, getReservas);
routerArena.get("/reservas/tabela", authenticateJWT, ListagemReservas);
routerArena.post("/reservas/agendar", authenticateJWT, createReserva);
routerArena.post("/quadras/criar", authenticateJWT, createQuadra);

// graficos
routerArena.get(
  "/graficos/receita-por-quadra",
  authenticateJWT,
  controller.receitaPorQuadra
);
routerArena.get(
  "/graficos/reservas-por-quadra",
  authenticateJWT,
  controller.reservasPorQuadra
);
routerArena.get(
  "/graficos/ocupacao-percentual",
  authenticateJWT,
  controller.ocupacaoPercentual
);
routerArena.get(
  "/graficos/receita-mensal",
  authenticateJWT,
  controller.receitaMensal
);

export { routerArena };
