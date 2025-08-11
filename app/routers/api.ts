import { Router } from "express";
import { routerProdutos } from "./produtos/router";
import { routerContas } from "./contas/router";
import { routerClientes } from "./clientes/router";
import { routerVendas } from "./vendas/router";
import { monitorRouter } from "./monitor/router";
import { routerLancamentos } from "./lancamentos/router";
import { routerPrinter } from "./impressao/router";
import routerUploads from "./uploads/router";
import { routerUsuarios } from "./administracao/usuarios/router";
import { routerGerencia } from "./gerencia/router";

const RouterMain = Router();

RouterMain.use("/api/contas", routerContas);
RouterMain.use("/api/produtos", routerProdutos);
RouterMain.use("/api/usuarios", routerUsuarios);
RouterMain.use("/api/clientes", routerClientes);
RouterMain.use("/api/gerencia/", routerGerencia);
RouterMain.use("/api/lancamentos", routerLancamentos);
RouterMain.use("/api/vendas", routerVendas);
RouterMain.use("/api/printer", routerPrinter);
RouterMain.use("/api/system", monitorRouter);
RouterMain.use("/api/uploads", routerUploads);

export { RouterMain };