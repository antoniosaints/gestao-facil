import { Router, Request, Response } from "express";
import multer, { MulterError } from "multer";
import path from "path";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { authenticateJWT } from "../../middlewares/auth";
import { prisma } from "../../utils/prisma";
import routerUploadArquivos from "../../controllers/uploads/uploads";
import {
  buildScopedUploadKey,
  deleteStoredFile,
  uploadPublicFile,
} from "../../services/uploads/fileStorageService";
import { refreshUserSessionCache } from "../../services/session/accountSessionCacheService";
import { sendSessionUpdated } from "../../hooks/contas/socket";

const routerUploads = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 5 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Formato de arquivo inválido, apenas arquivos JPEG, PNG, GIF ou WebP.",
        ),
      );
    }
  },
});

routerUploads.post(
  "/profile",
  authenticateJWT,
  async (req: Request, res: Response): Promise<any> => {
    const customData = getCustomRequest(req).customData;

    upload.single("profileImage")(req, res, async (err) => {
      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res
            .status(400)
            .json({ message: "Tamanho do arquivo excedeu o limite de 5MB." });
        }
      } else if (err) {
        return res.status(400).json({ message: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Arquivo não enviado." });
      }

      const currentConta = await prisma.contas.findUnique({
        where: { id: customData.contaId },
        select: { profile: true },
      });

      if (currentConta?.profile) {
        await deleteStoredFile(currentConta.profile);
      }

      const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
      const fileName = `profile${customData.contaId}${ext}`;
      const key = buildScopedUploadKey(
        customData.contaId,
        `profiles/account_${customData.contaId}`,
        fileName,
      );

      const file = await uploadPublicFile({
        key,
        body: req.file.buffer,
        contentType: req.file.mimetype,
        cacheControl: "public, max-age=3600",
      });

      await prisma.contas.update({
        where: { id: customData.contaId },
        data: { profile: file.reference },
      });

      return res.json({
        message:
          "Imagem de perfil enviada com sucesso, recarregue a pagina para aplicar.",
        path: file.reference,
        publicUrl: file.url,
        key: file.key,
        driver: file.driver,
      });
    });
  },
);

routerUploads.post(
  "/profile/user",
  authenticateJWT,
  async (req: Request, res: Response): Promise<any> => {
    const customData = getCustomRequest(req).customData;

    upload.single("profileImage")(req, res, async (err) => {
      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res
            .status(400)
            .json({ message: "Tamanho do arquivo excedeu o limite de 5MB." });
        }
      } else if (err) {
        return res.status(400).json({ message: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Arquivo não enviado." });
      }

      const currentUser = await prisma.usuarios.findUnique({
        where: {
          id: customData.userId,
          contaId: customData.contaId,
        },
        select: { profile: true },
      });

      if (currentUser?.profile) {
        await deleteStoredFile(currentUser.profile);
      }

      const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
      const fileName = `user-${customData.userId}${ext}`;
      const key = buildScopedUploadKey(
        customData.contaId,
        `profiles/users/user_${customData.userId}`,
        fileName,
      );

      const file = await uploadPublicFile({
        key,
        body: req.file.buffer,
        contentType: req.file.mimetype,
        cacheControl: "public, max-age=3600",
      });

      await prisma.usuarios.update({
        where: {
          id: customData.userId,
          contaId: customData.contaId,
        },
        data: { profile: file.reference },
      });

      await refreshUserSessionCache(customData.contaId, customData.userId);
      sendSessionUpdated(customData.contaId, {
        reason: "avatar-usuario-atualizado",
        contaId: customData.contaId,
        userId: customData.userId,
      });

      return res.json({
        message: "Imagem de perfil do usuário enviada com sucesso.",
        path: file.reference,
        publicUrl: file.url,
        key: file.key,
        driver: file.driver,
      });
    });
  },
);

routerUploads.use("/cloud", authenticateJWT, routerUploadArquivos);
export default routerUploads;
