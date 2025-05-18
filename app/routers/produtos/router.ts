import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import {
  gerarEtiquetasProduto,
  relatorioProdutoMovimentacoes,
  relatorioProdutos,
} from "../../controllers/produtos/relatorios";
import { tableProdutos } from "../../controllers/produtos/table";
import {
  deleteProduto,
  getProduto,
  reposicaoProduto,
  saveProduto,
} from "../../controllers/produtos/produtos";

const routerProdutos = Router();

routerProdutos.get("/relatorio", authenticateJWT, relatorioProdutos);
routerProdutos.get(
  "/relatorio/reposicao/:id",
  authenticateJWT,
  relatorioProdutoMovimentacoes
);
routerProdutos.get("", authenticateJWT, tableProdutos);
routerProdutos.get("/:id", authenticateJWT, getProduto);
routerProdutos.post("/reposicao", authenticateJWT, reposicaoProduto);
routerProdutos.post("", authenticateJWT, saveProduto);
routerProdutos.delete("/:id", authenticateJWT, deleteProduto);
routerProdutos.get("/:id/etiquetas", authenticateJWT, gerarEtiquetasProduto);

export { routerProdutos };
