import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { coreIaGate } from "../../middlewares/coreIaGate";
import {
  gerarDescricaoProduto,
  assistenteTexto,
  redigirOrdemServico,
} from "../../controllers/ia/texto";
import {
  sugerirRespostaAtendimento,
  resumoAtendimento,
} from "../../controllers/ia/atendimento";
import { insightsDashboard } from "../../controllers/ia/insights";
import { categorizarLancamento } from "../../controllers/ia/financeiro";
import { reposicaoSugestao } from "../../controllers/ia/estoque";
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

// ---- Fase 2: atendimento (WhatsApp) ----
routerIa.post("/atendimento/sugerir-resposta", sugerirRespostaAtendimento);
routerIa.post("/atendimento/resumo", resumoAtendimento);

// ---- Fase 3: análise & inteligência ----
routerIa.post("/insights/dashboard", insightsDashboard);
routerIa.post("/financeiro/categorizar", categorizarLancamento);

// ---- Fase 4: avançado ----
routerIa.post("/estoque/reposicao-sugestao", reposicaoSugestao);
