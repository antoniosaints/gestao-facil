import { requireStoreApp } from "../../middlewares/appModuleAccess";
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

routerArena.get("/quadras", auth, requireStoreApp("arena"), getQuadras);
routerArena.get("/quadras/select2", auth, requireStoreApp("arena"), select2ArenaQuadras);
routerArena.get("/quadras/:quadraId/disponiveis", auth, requireStoreApp("arena"), getSlotsDisponiveis);
routerArena.get("/reservas", auth, requireStoreApp("arena"), getReservas);
routerArena.delete("/reservas", auth, requireStoreApp("arena"), deleteReserva);
routerArena.post("/reservas/agendar", auth, requireStoreApp("arena"), createReserva);
routerArena.get("/reservas/confirmar", auth, requireStoreApp("arena"), confirmarReserva);
routerArena.get("/reservas/cancelar", auth, requireStoreApp("arena"), cancelarReserva);
routerArena.get("/reservas/estornar", auth, requireStoreApp("arena"), estornarReserva);
routerArena.get("/reservas/finalizar", auth, requireStoreApp("arena"), finalizarReserva);
routerArena.post("/quadras/criar", auth, requireStoreApp("arena"), createQuadra);

//tabelas
routerArena.get("/quadras/tabela", auth, requireStoreApp("arena"), ListagemQuadras);
routerArena.get("/reservas/tabela", auth, requireStoreApp("arena"), ListagemReservas);
routerArena.get("/comandas/tabela", auth, requireStoreApp("arena"), ListagemComandas);

//publico
routerArena.post("/reservas/publico/horarios", getSlotsDisponiveisPublico);
routerArena.get("/quadras/publico/agendamento", getQuadrasPublico);
routerArena.post("/reservas/publico/agendamento", createReservaPublico);

// graficos
routerArena.get("/graficos/receita-por-quadra", auth, requireStoreApp("arena"), g.receitaPorQuadra);
routerArena.get("/graficos/reservas-por-quadra", auth, requireStoreApp("arena"), g.reservasPorQuadra);
routerArena.get("/graficos/ocupacao-percentual", auth, requireStoreApp("arena"), g.ocupacaoPercentual);
routerArena.get("/graficos/receita-mensal", auth, requireStoreApp("arena"), g.receitaMensal);

export { routerArena };
