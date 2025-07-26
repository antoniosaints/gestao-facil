import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { atualizarStatusLancamentos, criarLancamento, deletarLancamento, estornarParcela, gerarReciboPdf, listarParcelas, pagarMultiplasParcelas, pagarParcela } from "../../controllers/financeiro/gerenciar";

const routerLancamentos = Router();

routerLancamentos.post("/", authenticateJWT, criarLancamento);
routerLancamentos.post("/parcelas/:id/pagar", authenticateJWT, pagarParcela);
routerLancamentos.post("/parcelas/pagar-multiplas", authenticateJWT, pagarMultiplasParcelas);
routerLancamentos.post("/parcelas/:id/estornar", authenticateJWT, estornarParcela);
routerLancamentos.post("/parcelas/cliente", authenticateJWT, listarParcelas);
routerLancamentos.post("/parcelas/:id/recibo", authenticateJWT, gerarReciboPdf);
routerLancamentos.delete("/:id", authenticateJWT, deletarLancamento);

export {
    routerLancamentos
}