import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { coreIaGate } from "../../middlewares/coreIaGate";
import {
  gerarDescricaoProduto,
  assistenteTexto,
  redigirOrdemServico,
} from "../../controllers/ia/texto";
import { meuUsoIa } from "../../controllers/ia/uso";

// Todas as features de IA exigem login e o app "core-ia" ativo.
export const routerIa = Router();
routerIa.use(authenticateJWT, coreIaGate);

// Uso da própria conta (indicador de limite/consumo)
routerIa.get("/uso", meuUsoIa);

// ---- Fase 1: geração de texto ----
routerIa.post("/produto/descricao", gerarDescricaoProduto);
routerIa.post("/texto", assistenteTexto);
routerIa.post("/os/redigir", redigirOrdemServico);
