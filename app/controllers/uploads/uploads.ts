import express, { Request, Response } from "express";
import multer, { MulterError } from "multer";
import { randomUUID } from "crypto";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import {
  buildPublicFileUrl,
  buildScopedUploadKey,
  deleteStoredFile,
  normalizeStorageKey,
  uploadPublicFile,
} from "../../services/uploads/fileStorageService";
import { downscaleIfImage } from "../../services/uploads/imageProcessingService";

const routerUploadArquivos = express.Router();

// Sem limite/filtro o multer aceitaria arquivo de qualquer tipo e tamanho em
// memória (DoS/OOM) e subiria conteúdo arbitrário para um bucket público. O
// único consumidor desta rota envia imagens; restringimos a imagens e a 8MB
// (imagens ainda são reescaladas por downscaleIfImage antes de subir).
const MAX_UPLOAD_BYTES = 1024 * 1024 * 8;
const ALLOWED_UPLOAD_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOAD_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Formato inválido. Envie apenas imagens JPEG, PNG, GIF ou WebP."));
    }
  },
});

function sanitizeDirectory(input?: string) {
  if (!input) return "";

  return input
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

routerUploadArquivos.post("/r2", (req, res): any => {
  upload.single("file")(req, res, async (err): Promise<any> => {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ status: 413, message: "Arquivo excede o limite de 8MB." });
      }
      return res.status(400).json({ status: 400, message: err.message });
    } else if (err) {
      return res.status(400).json({ status: 400, message: err.message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ status: 400, message: "Nenhum arquivo enviado" });
      }

      const customData = getCustomRequest(req).customData;
      const { originalname, buffer, mimetype } = req.file;

      const diretorio = sanitizeDirectory(req.body.diretorio);
      if (!diretorio) {
        return res.status(400).json({ status: 400, message: "Nenhum diretorio enviado, especifique o local de armazenamento" });
      }

      // Scale down para qualquer imagem: reescala/comprime antes de subir. Não-imagens passam direto.
      const processed = await downscaleIfImage(buffer, mimetype);
      const body = processed?.buffer ?? buffer;
      const contentType = processed?.contentType ?? mimetype;

      const ext = processed?.extension
        ?? (originalname.includes(".") ? originalname.split(".").pop() : undefined);
      const generatedFileName = `${Date.now()}-${randomUUID()}${ext ? `.${ext}` : ""}`;
      const key = buildScopedUploadKey(customData.contaId, diretorio, generatedFileName);

      const file = await uploadPublicFile({
        key,
        body,
        contentType,
      });

      res.json({
        success: true,
        key: file.key,
        reference: file.reference,
        url: file.reference,
        publicUrl: file.url,
        driver: file.driver,
      });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

routerUploadArquivos.get("/r2/url", async (req, res): Promise<any> => {
  try {
    if (!req.query.key) return res.status(400).json({ error: "Parâmetro key é obrigatório." });

    const key = normalizeStorageKey(String(req.query.key));
    if (!key || key.includes("..")) {
      return res.status(400).json({ error: "Caminho inválido." });
    }

    const url = buildPublicFileUrl(key);
    res.json({ url, publicUrl: url });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

routerUploadArquivos.get("/r2/download", async (req, res): Promise<any> => {
  try {
    if (!req.query.key) return res.status(400).json({ error: "Parâmetro key é obrigatório." });

    const key = normalizeStorageKey(String(req.query.key));
    if (!key || key.includes("..")) {
      return res.status(400).json({ error: "Caminho inválido." });
    }

    const url = buildPublicFileUrl(key);
    res.json({ url, publicUrl: url });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

routerUploadArquivos.delete("/r2/delete", async (req: Request, res: Response): Promise<any> => {
  try {
    if (!req.query.key) return res.status(400).json({ error: "Parâmetro 'key' é obrigatório." });

    const key = normalizeStorageKey(String(req.query.key));
    if (!key || key.includes("..")) {
      return res.status(400).json({ error: "Caminho inválido." });
    }

    await deleteStoredFile(key);
    res.json({ success: true, message: `Arquivo '${key}' deletado com sucesso.` });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default routerUploadArquivos;
