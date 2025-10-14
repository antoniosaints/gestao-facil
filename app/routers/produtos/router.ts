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
import { ListagemMobileProdutos } from "../../controllers/produtos/mobile";
import {
  getCsvBase,
  postImportarProdutos,
} from "../../controllers/produtos/lote/uploadcsv";
import multer from "multer";
import { select2Produtos } from "../../controllers/produtos/hooks";
import {
  getGiroEstoque,
  getLucroMedioProdutos,
  getMargemMedia,
  getProdutosMaisRepostos,
  getProdutosMenosSaida,
  getReposicaoMensal,
  getResumoGeralProdutos,
  getTicketMedio,
} from "../../controllers/produtos/graficos";

const routerProdutos = Router();
const upload = multer({ dest: "uploads/" });

routerProdutos.get("/relatorio", authenticateJWT, relatorioProdutos);
routerProdutos.get(
  "/relatorio/reposicao/:id",
  authenticateJWT,
  relatorioProdutoMovimentacoes
);

routerProdutos.get("/select2", authenticateJWT, select2Produtos);
routerProdutos.get("/mobile/data", authenticateJWT, ListagemMobileProdutos);
routerProdutos.get("/lista/geral", authenticateJWT, getProdutos);
routerProdutos.get("/download/csv", authenticateJWT, getCsvBase);

routerProdutos.get("/:produtoId/resumo", authenticateJWT, getResumoProduto);
routerProdutos.get("/:id/etiquetas", authenticateJWT, gerarEtiquetasProduto);

// rota genérica deve vir por último
routerProdutos.get("/:id", authenticateJWT, getProduto);

routerProdutos.post("/", authenticateJWT, saveProduto);
routerProdutos.get("/", authenticateJWT, tableProdutos);
routerProdutos.post("/reposicao", authenticateJWT, reposicaoProduto);
routerProdutos.post(
  "/importar/csv",
  authenticateJWT,
  upload.single("arquivo"),
  postImportarProdutos
);

routerProdutos.delete("/:id", authenticateJWT, deleteProduto);

//graficos
routerProdutos.get(
  "/graficos/reposicao-mensal",
  authenticateJWT,
  getReposicaoMensal
);
routerProdutos.get(
  "/graficos/mais-repostos",
  authenticateJWT,
  getProdutosMaisRepostos
);
routerProdutos.get(
  "/graficos/menos-saida",
  authenticateJWT,
  getProdutosMenosSaida
);
routerProdutos.get(
  "/graficos/lucro-medio",
  authenticateJWT,
  getLucroMedioProdutos
);
routerProdutos.get("/graficos/ticket-medio", authenticateJWT, getTicketMedio);
routerProdutos.get("/graficos/giro-estoque", authenticateJWT, getGiroEstoque);
routerProdutos.get("/graficos/margem-media", authenticateJWT, getMargemMedia);
routerProdutos.get("/graficos/resumo-geral", authenticateJWT, getResumoGeralProdutos);

export { routerProdutos };
