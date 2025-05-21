import { Router } from "express";
import { routerProdutos } from "./produtos/router";
import { routerContas } from "./contas/router";
import { routerClientes } from "./clientes/router";
import { routerVendas } from "./vendas/router";
import { monitorRouter } from "./monitor/router";

const RouterMain = Router();
// Contas
RouterMain.use("/contas", routerContas);
// Produtos
RouterMain.use("/produtos", routerProdutos);
// Clientes
RouterMain.use("/clientes", routerClientes);
// Vendas
RouterMain.use("/vendas", routerVendas);
// monitor
RouterMain.use("/system", monitorRouter);

export { RouterMain };