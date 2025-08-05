import { Router, Request, Response } from "express";
import multer, { MulterError } from "multer";
import { globSync } from "glob";
import path from "path";
import fs from "fs";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { authenticateJWT } from "../../middlewares/auth";
import { prisma } from "../../utils/prisma";

const routerUploads = Router();
const rootPath = path.resolve(__dirname);

// Configuração do Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const customData = getCustomRequest(req).customData;
    const dir = path.join(
      rootPath,
      "../../../code/public",
      "profiles",
      String(customData.contaId),
      "profile"
    );

    console.log(dir);

    // Garante que o diretório exista
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },

  filename: (req, file, cb) => {
    const customData = getCustomRequest(req).customData;
    const ext = path.extname(file.originalname).toLowerCase();
    const filenameBase = "profile" + String(customData.contaId);
    const filename = filenameBase + ext;

    const dir = path.join(
      rootPath,
      "../../../code/public",
      "profiles",
      String(customData.contaId),
      "profile"
    );

    // Apaga todos os arquivos da pasta
    if (fs.existsSync(dir)) {
      const arquivos = globSync(path.join(dir, "*"));
      for (const filePath of arquivos) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error("Erro ao apagar arquivo:", filePath, err);
        }
      }
    }

    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 5 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Formato de arquivo inválido, apenas arquivos JPEG, PNG, GIF ou WebP."));
    }
  },
});

// Rota de upload
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

      const path = `profiles/${customData.contaId}/profile/${req.file.filename}`;

      await prisma.contas.update({
        where: { id: customData.contaId },
        data: { profile: path },
      });

      return res.json({
        message: "Imagem de perfil enviada com sucesso, recarregue a pagina para aplicar.",
        path: `/public/profiles/${customData.contaId}/profile/${req.file.filename}`,
      });
    });
  }
);

export default routerUploads;
