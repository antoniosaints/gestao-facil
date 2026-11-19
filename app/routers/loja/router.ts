import { requireStoreApp } from "../../middlewares/appModuleAccess";
import { Router } from "express";
import multer from "multer";
import { authenticateJWT } from "../../middlewares/auth";
import {
  deleteLojaBanner,
  getLojaConfig,
  saveLojaConfig,
  uploadLojaBanner,
} from "../../controllers/loja/loja";
import { createPublicOrder, getPublicProducts, getPublicStore, previewCheckout, retryPublicOrder, showPublicOrder } from "../../controllers/loja/publica";
import { actOnStoreOrder, deleteStoreOrder, listStoreOrders, showStoreOrder } from "../../controllers/loja/pedidos";
import { addProdutoSecao, createSecao, deleteSecao, listSecoes, removeProdutoSecao, updateSecao } from "../../controllers/loja/secoes";
import { getResumoLoja } from "../../controllers/loja/resumo";
import { deleteAddress, forgotPassword, login, logout, me, refresh, register, resetPassword, saveAddress, verify } from "../../controllers/loja/auth";
import { optionalStoreCustomer, requireStoreCustomer } from "../../middlewares/storeCustomerAuth";

const routerLoja = Router();
// Upload do banner em memória (o scale down / envio ao R2 fica no controller). Limite 5MB.
const uploadBanner = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

routerLoja.get("/publica/:slug", getPublicStore as any);
routerLoja.get("/publica/:slug/produtos", getPublicProducts as any);
routerLoja.post("/publica/:slug/checkout/preview", previewCheckout as any);
routerLoja.post("/publica/:slug/pedidos", optionalStoreCustomer as any, createPublicOrder as any);
routerLoja.post("/publica/:slug/pedidos/:publicId/retry", optionalStoreCustomer as any, retryPublicOrder as any);
routerLoja.get("/publica/:slug/pedidos/:publicId", optionalStoreCustomer as any, showPublicOrder as any);
routerLoja.post("/publica/:slug/auth/register", register as any);
routerLoja.post("/publica/:slug/auth/verify", verify as any);
routerLoja.post("/publica/:slug/auth/login", login as any);
routerLoja.post("/publica/:slug/auth/refresh", refresh as any);
routerLoja.post("/publica/:slug/auth/logout", logout as any);
routerLoja.post("/publica/:slug/auth/forgot-password", forgotPassword as any);
routerLoja.post("/publica/:slug/auth/reset-password", resetPassword as any);
routerLoja.get("/publica/:slug/auth/me", requireStoreCustomer as any, me as any);
routerLoja.post("/publica/:slug/auth/addresses", requireStoreCustomer as any, saveAddress as any);
routerLoja.put("/publica/:slug/auth/addresses/:id", requireStoreCustomer as any, saveAddress as any);
routerLoja.delete("/publica/:slug/auth/addresses/:id", requireStoreCustomer as any, deleteAddress as any);

routerLoja.get("/resumo", authenticateJWT, requireStoreApp("loja-virtual"), getResumoLoja);
routerLoja.get("/config", authenticateJWT, requireStoreApp("loja-virtual"), getLojaConfig);
routerLoja.put("/config", authenticateJWT, requireStoreApp("loja-virtual"), saveLojaConfig);
routerLoja.post("/config/banner", authenticateJWT, requireStoreApp("loja-virtual"), uploadBanner.single("file"), uploadLojaBanner);
routerLoja.delete("/config/banner", authenticateJWT, requireStoreApp("loja-virtual"), deleteLojaBanner);
routerLoja.get("/secoes", authenticateJWT, requireStoreApp("loja-virtual"), listSecoes as any);
routerLoja.post("/secoes", authenticateJWT, requireStoreApp("loja-virtual"), createSecao as any);
routerLoja.patch("/secoes/:id", authenticateJWT, requireStoreApp("loja-virtual"), updateSecao as any);
routerLoja.delete("/secoes/:id", authenticateJWT, requireStoreApp("loja-virtual"), deleteSecao as any);
routerLoja.post("/secoes/:id/produtos", authenticateJWT, requireStoreApp("loja-virtual"), addProdutoSecao as any);
routerLoja.delete("/secoes/:id/produtos/:produtoBaseId", authenticateJWT, requireStoreApp("loja-virtual"), removeProdutoSecao as any);
routerLoja.get("/pedidos", authenticateJWT, requireStoreApp("loja-virtual"), listStoreOrders as any);
routerLoja.get("/pedidos/:id", authenticateJWT, requireStoreApp("loja-virtual"), showStoreOrder as any);
routerLoja.delete("/pedidos/:id", authenticateJWT, requireStoreApp("loja-virtual"), deleteStoreOrder as any);
routerLoja.post("/pedidos/:id/:action", authenticateJWT, requireStoreApp("loja-virtual"), actOnStoreOrder as any);

export { routerLoja };
