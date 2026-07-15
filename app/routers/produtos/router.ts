import { Router } from "express";
import { authenticateJWT } from "../../middlewares/auth";
import {
  gerarEtiquetasProduto,
  gerarFolhaEtiquetas,
  relatorioLucroProduto,
  relatorioProdutoMovimentacoes,
  relatorioProdutos,
  relatorioVendasProduto,
} from "../../controllers/produtos/relatorios";
import { tableProdutos } from "../../controllers/produtos/table";
import {
  descarteProduto,
  deleteCategoriaProduto,
  deleteProduto,
  deleteProdutoVariante,
  deleteVarianteImagem,
  getCatalogoPublico,
  getCategoriasProduto,
  gerarSkuProduto,
  getProduto,
  getProdutos,
  getProdutoVariante,
  getResumoProduto,
  getResumoProdutoVariante,
  getVariantesProduto,
  reposicaoProduto,
  reposicaoLoteProduto,
  saveCategoriaProduto,
  saveProduto,
  saveProdutoVariante,
  setCatalogoVisibilidade,
  uploadVarianteImagem,
} from "../../controllers/produtos/produtos";
import { ListagemMobileProdutos } from "../../controllers/produtos/mobile";
import {
  resumoMovimentacoes,
  tableMovimentacoes,
} from "../../controllers/produtos/movimentacoes";
import {
  getCsvBase,
  postImportarProdutos,
} from "../../controllers/produtos/lote/uploadcsv";
import multer from "multer";
import {
  select2CategoriasProduto,
  select2FiltrosProdutos,
  select2Produtos,
} from "../../controllers/produtos/hooks";
import {
  getDistribuicaoCategorias,
  getFluxoEstoqueMensal,
  getGiroEstoque,
  getLucroMedioProdutos,
  getMargemMedia,
  getProdutosMaisRepostos,
  getProdutosMenosSaida,
  getPainelProdutos,
  getReposicaoMensal,
  getResumoGeralProdutos,
  getSaudeEstoqueProdutos,
  getTicketMedio,
} from "../../controllers/produtos/graficos";

const routerProdutos = Router();
const upload = multer({ dest: "uploads/" });
// Upload de imagem de variante em memória (o scale down / envio ao R2 fica no controller). Limite 5MB.
const uploadImagem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Catálogo público (loja virtual): sem autenticação. Deve vir antes das rotas com `/:id`.
routerProdutos.get("/publico/catalogo", getCatalogoPublico);

routerProdutos.get("/relatorio", authenticateJWT, relatorioProdutos);
routerProdutos.get("/relatorio/vendas", authenticateJWT, relatorioVendasProduto);
routerProdutos.get("/relatorio/lucro", authenticateJWT, relatorioLucroProduto);
routerProdutos.get(
  "/relatorio/reposicao/:id",
  authenticateJWT,
  relatorioProdutoMovimentacoes
);

routerProdutos.get("/select2", authenticateJWT, select2Produtos);
routerProdutos.get("/filtros/select2", authenticateJWT, select2FiltrosProdutos);
routerProdutos.get(
  "/categorias/select2",
  authenticateJWT,
  select2CategoriasProduto
);
routerProdutos.get("/categorias", authenticateJWT, getCategoriasProduto);
routerProdutos.get("/mobile/data", authenticateJWT, ListagemMobileProdutos);
routerProdutos.get("/lista/geral", authenticateJWT, getProdutos);
routerProdutos.get("/gerar-sku", authenticateJWT, gerarSkuProduto);
routerProdutos.get("/download/csv", authenticateJWT, getCsvBase);
routerProdutos.get("/movimentacoes/resumo", authenticateJWT, resumoMovimentacoes);
routerProdutos.get("/movimentacoes", authenticateJWT, tableMovimentacoes);

routerProdutos.get(
  "/variantes/:id/resumo",
  authenticateJWT,
  getResumoProdutoVariante
);
routerProdutos.get("/variantes/:id", authenticateJWT, getProdutoVariante);
routerProdutos.get("/:id/variantes", authenticateJWT, getVariantesProduto);
routerProdutos.get("/:produtoId/resumo", authenticateJWT, getResumoProduto);
routerProdutos.get("/:id/etiquetas", authenticateJWT, gerarEtiquetasProduto);

// rota genérica deve vir por último
routerProdutos.get("/:id", authenticateJWT, getProduto);

routerProdutos.post("/etiquetas/folha", authenticateJWT, gerarFolhaEtiquetas);
routerProdutos.post("/", authenticateJWT, saveProduto);
routerProdutos.post("/variantes", authenticateJWT, saveProdutoVariante);
routerProdutos.post("/categorias", authenticateJWT, saveCategoriaProduto);
routerProdutos.get("/", authenticateJWT, tableProdutos);
routerProdutos.patch("/catalogo/visibilidade", authenticateJWT, setCatalogoVisibilidade);
routerProdutos.post("/reposicao/lote", authenticateJWT, reposicaoLoteProduto);
routerProdutos.post("/reposicao", authenticateJWT, reposicaoProduto);
routerProdutos.post("/descarte", authenticateJWT, descarteProduto);
routerProdutos.post(
  "/importar/csv",
  authenticateJWT,
  upload.single("arquivo"),
  postImportarProdutos
);

routerProdutos.post(
  "/variantes/:id/imagem",
  authenticateJWT,
  uploadImagem.single("file"),
  uploadVarianteImagem
);
routerProdutos.delete("/variantes/:id/imagem", authenticateJWT, deleteVarianteImagem);

routerProdutos.delete("/:id", authenticateJWT, deleteProduto);
routerProdutos.delete("/variantes/:id", authenticateJWT, deleteProdutoVariante);
routerProdutos.delete("/categorias/:id", authenticateJWT, deleteCategoriaProduto);

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
routerProdutos.get(
  "/graficos/fluxo-estoque",
  authenticateJWT,
  getFluxoEstoqueMensal
);
routerProdutos.get(
  "/graficos/categorias",
  authenticateJWT,
  getDistribuicaoCategorias
);
routerProdutos.get(
  "/graficos/saude-estoque",
  authenticateJWT,
  getSaudeEstoqueProdutos
);
routerProdutos.get("/graficos/resumo-geral", authenticateJWT, getResumoGeralProdutos);
routerProdutos.get("/graficos/painel", authenticateJWT, getPainelProdutos);

export { routerProdutos };
