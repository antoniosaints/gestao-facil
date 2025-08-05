import { Router } from "express";
import { routerProdutos } from "./produtos/router";
import { routerContas } from "./contas/router";
import { routerClientes } from "./clientes/router";
import { routerVendas } from "./vendas/router";
import { monitorRouter } from "./monitor/router";
import { routerLancamentos } from "./lancamentos/router";
import { routerPrinter } from "./impressao/router";
import routerUploads from "./uploads/router";

const RouterMain = Router();

RouterMain.use("/contas", routerContas);
RouterMain.use("/produtos", routerProdutos);
RouterMain.use("/clientes", routerClientes);
RouterMain.use("/lancamentos", routerLancamentos);
RouterMain.use("/vendas", routerVendas);
RouterMain.use("/printer", routerPrinter);
RouterMain.use("/system", monitorRouter);
RouterMain.use("/uploads", routerUploads);

export { RouterMain };