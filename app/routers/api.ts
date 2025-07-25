import { Router } from "express";
import { routerProdutos } from "./produtos/router";
import { routerContas } from "./contas/router";
import { routerClientes } from "./clientes/router";
import { routerVendas } from "./vendas/router";
import { monitorRouter } from "./monitor/router";
import { routerLancamentos } from "./lancamentos/router";

const RouterMain = Router();

RouterMain.use("/contas", routerContas);
RouterMain.use("/produtos", routerProdutos);
RouterMain.use("/clientes", routerClientes);
RouterMain.use("/lancamentos", routerLancamentos);
RouterMain.use("/vendas", routerVendas);
RouterMain.use("/system", monitorRouter);

export { RouterMain };