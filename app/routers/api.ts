import { Router } from "express";
import { routerProdutos } from "./produtos/router";
import { routerContas } from "./contas/router";
import { routerClientes } from "./clientes/router";
import { routerVendas } from "./vendas/router";
import { monitorRouter } from "./monitor/router";
import { routerLancamentos } from "./lancamentos/router";
import routerUploads from "./uploads/router";
import { routerUsuarios } from "./administracao/usuarios/router";
import { routerGerencia } from "./gerencia/router";
import { routerServicos } from "./servicos/router";
import { routerDefault } from "./default";
import { routerAdminMain } from "./administracao/router";
import { routerArena } from "./arena/router";

const RouterMain = Router();

RouterMain.use(routerDefault);
RouterMain.use("/api/contas", routerContas);
RouterMain.use("/api/produtos", routerProdutos);
RouterMain.use("/api/servicos", routerServicos);
RouterMain.use("/api/usuarios", routerUsuarios);
RouterMain.use("/api/clientes", routerClientes);
RouterMain.use("/api/gerencia", routerGerencia);
RouterMain.use("/api/lancamentos", routerLancamentos);
RouterMain.use("/api/vendas", routerVendas);
RouterMain.use("/api/system", monitorRouter);
RouterMain.use("/api/uploads", routerUploads);
RouterMain.use("/api/admin", routerAdminMain);
RouterMain.use("/api/arenas", routerArena);

export { RouterMain };