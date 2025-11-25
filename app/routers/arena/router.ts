import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { createReserva, getReservas, getSlotsDisponiveis } from "../../controllers/arena/reservas/gerenciar";
import { createQuadra, getQuadras } from "../../controllers/arena/quadras/gerenciar";
import { select2ArenaQuadras } from "../../controllers/arena/quadras/hooks";

const routerArena = Router();

routerArena.get("/quadras", authenticateJWT, getQuadras);
routerArena.get("/quadras/select2", authenticateJWT, select2ArenaQuadras);
routerArena.get("/quadras/:quadraId/disponiveis", authenticateJWT, getSlotsDisponiveis);
routerArena.get("/reservas", authenticateJWT, getReservas);
routerArena.post("/reservas/agendar", authenticateJWT, createReserva);
routerArena.post("/quadras/criar", authenticateJWT, createQuadra);

export {
    routerArena
}