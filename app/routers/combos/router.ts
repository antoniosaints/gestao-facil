import { Router, type RequestHandler } from "express";
import multer from "multer";
import {
  deleteImage,
  destroy,
  index,
  options,
  show,
  store,
  update,
  uploadImage,
} from "../../controllers/combos/combos";
import { authenticateJWT } from "../../middlewares/auth";
import { requireCombosAccess } from "../../middlewares/combosAccess";

export const routerCombos = Router();
const uploadImagem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

routerCombos.use(authenticateJWT);
routerCombos.get("/opcoes", requireCombosAccess(1), options as unknown as RequestHandler);
routerCombos.get("/", requireCombosAccess(4), index as unknown as RequestHandler);
routerCombos.post("/", requireCombosAccess(4), store as unknown as RequestHandler);
routerCombos.post(
  "/:id/imagem",
  requireCombosAccess(4),
  uploadImagem.single("file"),
  uploadImage as unknown as RequestHandler,
);
routerCombos.delete("/:id/imagem", requireCombosAccess(4), deleteImage as unknown as RequestHandler);
routerCombos.get("/:id", requireCombosAccess(4), show as unknown as RequestHandler);
routerCombos.patch("/:id", requireCombosAccess(4), update as unknown as RequestHandler);
routerCombos.delete("/:id", requireCombosAccess(4), destroy as unknown as RequestHandler);
