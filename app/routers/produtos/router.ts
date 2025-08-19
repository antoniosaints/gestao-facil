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
  getResumoProduto,
  reposicaoProduto,
  saveProduto,
} from "../../controllers/produtos/produtos";
import { select2Produtos } from "../../controllers/produtos/hooks";
import { ListagemMobileProdutos } from "../../controllers/produtos/mobile";
import { getCsvBase, postImportarProdutos } from "../../controllers/produtos/lote/uploadcsv";
import multer from "multer";

const routerProdutos = Router();
const upload = multer({dest: 'uploads/'});

routerProdutos.get("/relatorio", authenticateJWT, relatorioProdutos);
routerProdutos.get(
  "/relatorio/reposicao/:id",
  authenticateJWT,
  relatorioProdutoMovimentacoes
);
routerProdutos.post("/tabela", authenticateJWT, tableProdutos);
routerProdutos.get("/mobile/data", authenticateJWT, ListagemMobileProdutos);
routerProdutos.get("/lista/geral", authenticateJWT, getProdutos);
routerProdutos.get("/:id", authenticateJWT, getProduto);
routerProdutos.get("/:produtoId/resumo", authenticateJWT, getResumoProduto);
routerProdutos.post("/reposicao", authenticateJWT, reposicaoProduto);
routerProdutos.post("", authenticateJWT, saveProduto);
routerProdutos.delete("/:id", authenticateJWT, deleteProduto);
routerProdutos.get("/:id/etiquetas", authenticateJWT, gerarEtiquetasProduto);
routerProdutos.get("/download/csv", authenticateJWT, getCsvBase);
routerProdutos.post("/importar/csv", authenticateJWT, upload.single('arquivo'), postImportarProdutos);

//select2
routerProdutos.get("/select2/lista", authenticateJWT, select2Produtos);

export { routerProdutos };
