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
  getProdutos,
  reposicaoProduto,
  saveProduto,
} from "../../controllers/produtos/produtos";
import { select2Produtos } from "../../controllers/produtos/hooks";

const routerProdutos = Router();

routerProdutos.get("/relatorio", authenticateJWT, relatorioProdutos);
routerProdutos.get(
  "/relatorio/reposicao/:id",
  authenticateJWT,
  relatorioProdutoMovimentacoes
);
routerProdutos.get("", authenticateJWT, tableProdutos);
routerProdutos.get("/lista/geral", authenticateJWT, getProdutos);
routerProdutos.get("/:id", authenticateJWT, getProduto);
routerProdutos.post("/reposicao", authenticateJWT, reposicaoProduto);
routerProdutos.post("", authenticateJWT, saveProduto);
routerProdutos.delete("/:id", authenticateJWT, deleteProduto);
routerProdutos.get("/:id/etiquetas", authenticateJWT, gerarEtiquetasProduto);

//select2
routerProdutos.get("/select2/lista", authenticateJWT, select2Produtos);

export { routerProdutos };
