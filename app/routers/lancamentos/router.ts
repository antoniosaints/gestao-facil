import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import { criarLancamento, deletarLancamento, estornarParcela, gerarReciboPdf, listarParcelas, pagarMultiplasParcelas, pagarParcela } from "../../controllers/financeiro/gerenciar";
import { tableLancamentos } from "../../controllers/financeiro/table";

const routerLancamentos = Router();

routerLancamentos.post("/", authenticateJWT, criarLancamento);
routerLancamentos.get("/getDataTable", authenticateJWT, tableLancamentos);
routerLancamentos.post("/parcelas/:id/pagar", authenticateJWT, pagarParcela);
routerLancamentos.post("/parcelas/pagar-multiplas", authenticateJWT, pagarMultiplasParcelas);
routerLancamentos.post("/parcelas/:id/estornar", authenticateJWT, estornarParcela);
routerLancamentos.post("/parcelas/cliente", authenticateJWT, listarParcelas);
routerLancamentos.post("/parcelas/:id/recibo", authenticateJWT, gerarReciboPdf);
routerLancamentos.delete("/:id", authenticateJWT, deletarLancamento);

export {
    routerLancamentos
}