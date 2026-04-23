import express, { Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import {
  buildPublicFileUrl,
  buildScopedUploadKey,
  deleteStoredFile,
  normalizeStorageKey,
  uploadPublicFile,
} from "../../services/uploads/fileStorageService";

const routerUploadArquivos = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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

routerUploadArquivos.post("/r2", upload.single("file"), async (req, res): Promise<any> => {
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

    const ext = originalname.includes(".") ? originalname.split(".").pop() : undefined;
    const generatedFileName = `${Date.now()}-${randomUUID()}${ext ? `.${ext}` : ""}`;
    const key = buildScopedUploadKey(customData.contaId, diretorio, generatedFileName);

    const file = await uploadPublicFile({
      key,
      body: buffer,
      contentType: mimetype,
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
