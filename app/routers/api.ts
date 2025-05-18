import { Router } from "express";
import { routerProdutos } from "./produtos/router";
import { routerContas } from "./contas/router";

const RouterMain = Router();
// Contas
RouterMain.use("/contas", routerContas);
// Produtos
RouterMain.use("/produtos", routerProdutos);

export { RouterMain };