import { Router } from "express";
import { authenticateJWT as auth } from "../../middlewares/auth";
import {
  cancelarReserva,
  confirmarReserva,
  createReserva,
  createReservaPublico,
  deleteReserva,
  estornarReserva,
  finalizarReserva,
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
import { ListagemComandas } from "../../controllers/arena/comandas/tabela";

const routerArena = Router();
const g = new ReservasChartsController();

routerArena.get("/quadras", auth, getQuadras);
routerArena.get("/quadras/select2", auth, select2ArenaQuadras);
routerArena.get("/quadras/:quadraId/disponiveis", auth, getSlotsDisponiveis);
routerArena.get("/reservas", auth, getReservas);
routerArena.delete("/reservas", auth, deleteReserva);
routerArena.post("/reservas/agendar", auth, createReserva);
routerArena.get("/reservas/confirmar", auth, confirmarReserva);
routerArena.get("/reservas/cancelar", auth, cancelarReserva);
routerArena.get("/reservas/estornar", auth, estornarReserva);
routerArena.get("/reservas/finalizar", auth, finalizarReserva);
routerArena.post("/quadras/criar", auth, createQuadra);

//tabelas
routerArena.get("/quadras/tabela", auth, ListagemQuadras);
routerArena.get("/reservas/tabela", auth, ListagemReservas);
routerArena.get("/comandas/tabela", auth, ListagemComandas);

//publico
routerArena.post("/reservas/publico/horarios", getSlotsDisponiveisPublico);
routerArena.get("/quadras/publico/agendamento", getQuadrasPublico);
routerArena.post("/reservas/publico/agendamento", createReservaPublico);

// graficos
routerArena.get("/graficos/receita-por-quadra", auth, g.receitaPorQuadra);
routerArena.get("/graficos/reservas-por-quadra", auth, g.reservasPorQuadra);
routerArena.get("/graficos/ocupacao-percentual", auth, g.ocupacaoPercentual);
routerArena.get("/graficos/receita-mensal", auth, g.receitaMensal);

export { routerArena };
