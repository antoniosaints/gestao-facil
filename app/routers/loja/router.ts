import { Router } from "express";
import multer from "multer";
import { authenticateJWT } from "../../middlewares/auth";
import {
  deleteLojaBanner,
  getLojaConfig,
  saveLojaConfig,
  uploadLojaBanner,
} from "../../controllers/loja/loja";

const routerLoja = Router();
// Upload do banner em memória (o scale down / envio ao R2 fica no controller). Limite 5MB.
const uploadBanner = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

routerLoja.get("/config", authenticateJWT, getLojaConfig);
routerLoja.put("/config", authenticateJWT, saveLojaConfig);
routerLoja.post("/config/banner", authenticateJWT, uploadBanner.single("file"), uploadLojaBanner);
routerLoja.delete("/config/banner", authenticateJWT, deleteLojaBanner);

export { routerLoja };
