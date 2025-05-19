import { Router } from "express";
import { routerProdutos } from "./produtos/router";
import { routerContas } from "./contas/router";
import { routerClientes } from "./clientes/router";

const RouterMain = Router();
// Contas
RouterMain.use("/contas", routerContas);
// Produtos
RouterMain.use("/produtos", routerProdutos);
// Clientes
RouterMain.use("/clientes", routerClientes);

export { RouterMain };