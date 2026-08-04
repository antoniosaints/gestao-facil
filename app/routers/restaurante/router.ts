import { Router, type RequestHandler } from "express";
import { createPublicOrder, getConfig, listCatalog, listCatalogProducts, listDeliveryZones, listOptionGroups, listOrders, previewPublicCheckout, publicMenu, publicTracking, saveCatalogItem, saveConfig, saveDeliveryZone, saveOptionGroup, transitionOrder } from "../../controllers/restaurante/restaurante";
import { authenticateJWT } from "../../middlewares/auth";
import { requireRestauranteAccess } from "../../middlewares/restauranteAccess";

export const routerRestaurante = Router();
const use = (handler: unknown) => handler as RequestHandler;

routerRestaurante.get("/publico/:slug/cardapio", use(publicMenu));
routerRestaurante.post("/publico/:slug/checkout/previa", use(previewPublicCheckout));
routerRestaurante.post("/publico/:slug/pedidos", use(createPublicOrder));
routerRestaurante.get("/publico/pedidos/:token", use(publicTracking));

routerRestaurante.use(authenticateJWT);
routerRestaurante.get("/configuracao", requireRestauranteAccess(4), use(getConfig));
routerRestaurante.put("/configuracao", requireRestauranteAccess(4), use(saveConfig));
routerRestaurante.get("/cardapio", requireRestauranteAccess(1), use(listCatalog));
routerRestaurante.get("/cardapio/produtos", requireRestauranteAccess(4), use(listCatalogProducts));
routerRestaurante.post("/cardapio", requireRestauranteAccess(4), use(saveCatalogItem));
routerRestaurante.patch("/cardapio/:id", requireRestauranteAccess(4), use(saveCatalogItem));
routerRestaurante.get("/grupos-opcoes", requireRestauranteAccess(1), use(listOptionGroups));
routerRestaurante.post("/grupos-opcoes", requireRestauranteAccess(4), use(saveOptionGroup));
routerRestaurante.patch("/grupos-opcoes/:id", requireRestauranteAccess(4), use(saveOptionGroup));
routerRestaurante.get("/zonas-entrega", requireRestauranteAccess(1), use(listDeliveryZones));
routerRestaurante.post("/zonas-entrega", requireRestauranteAccess(4), use(saveDeliveryZone));
routerRestaurante.patch("/zonas-entrega/:id", requireRestauranteAccess(4), use(saveDeliveryZone));
routerRestaurante.get("/pedidos", requireRestauranteAccess(1), use(listOrders));
routerRestaurante.post("/pedidos/:id/transicao", requireRestauranteAccess(2), use(transitionOrder));
