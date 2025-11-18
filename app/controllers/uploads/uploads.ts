import express, { Request, Response } from "express";
import multer from "multer";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Storage } from "../../services/s3/r2Cliente";
import { env } from "../../utils/dotenv";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { generatePresignedGetUrl } from "../../services/s3/r2Service";
import { randomUUID } from "crypto";

const routerUploadArquivos = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

routerUploadArquivos.post("/r2", upload.single("file"), async (req, res): Promise<any> => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 400, message: "Nenhum arquivo enviado" });
    }
    const customData = getCustomRequest(req).customData;
    const { originalname, buffer, mimetype } = req.file;

    if (!req.body.diretorio) {
      return res.status(400).json({ status: 400, message: "Nenhum diretorio enviado, especifique o local de armazenamento" });
    }
    const ext = originalname.split(".").pop();
    const diretorio = req.body.diretorio.trim().replace(/\/+$/, "");
    const newNameRandom = Date.now().toString() + randomUUID();
    const key = `${customData.contaId}/${diretorio}/${newNameRandom}.${ext}`;
    await r2Storage.send(new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimetype
    }));

    const url = key;
    res.json({ success: true, url });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

routerUploadArquivos.get("/r2/url", async (req, res): Promise<any> => {
  try {
    if (!req.query.key) return res.status(400).json({ error: "Parâmetro key é obrigatório." });
    const key = req.query.key as string;
    if (key.includes("..")) return res.status(400).json({ error: "Caminho inválido." });

    // validações extras aqui (autorização, escopo do usuário, etc.)
    const url = await generatePresignedGetUrl(key.trim(), 120); // 120s por exemplo
    res.json({ url, expiresIn: 120 });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});
routerUploadArquivos.get("/r2/download", async (req, res): Promise<any> => {
  try {
    if (!req.query.key) return res.status(400).json({ error: "Parâmetro key é obrigatório." });
    const key = req.query.key as string;
    if (key.includes("..")) return res.status(400).json({ error: "Caminho inválido." });

    // validações extras aqui (autorização, escopo do usuário, etc.)
    const url = await generatePresignedGetUrl(key.trim(), 120, true); // 120s por exemplo
    res.json({ url, expiresIn: 120 });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

routerUploadArquivos.delete("/r2/delete", async (req: Request, res: Response): Promise<any> => {
  try {
    if (!req.query.key) return res.status(400).json({ error: "Parâmetro 'key' é obrigatório." });
    const key = req.query.key as string;
    if (key.includes("..")) return res.status(400).json({ error: "Caminho inválido." });

    const data = await r2Storage.send(
      new DeleteObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key.trim(),
      })
    );

    res.json({ success: true, message: `Arquivo '${key}' deletado com sucesso.`, res: data });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default routerUploadArquivos;
