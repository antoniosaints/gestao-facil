import { Request, Response } from "express";
import { createSign } from "crypto";
import { readStoredFileBuffer } from "../../services/uploads/fileStorageService";

export const getCertificate = async (_req: Request, res: Response): Promise<any> => {
  try {
    const file = await readStoredFileBuffer("certificados/public.crt");
    res.type("text/plain").send(file.toString("utf8"));
  } catch (error) {
    console.log(error);
    res.status(500).send("CERT_ERROR");
  }
};

export const downloadCertificate = async (_req: Request, res: Response): Promise<any> => {
  try {
    const file = await readStoredFileBuffer("certificados/public.crt");

    res.setHeader("Content-Disposition", 'attachment; filename="public.crt"');
    res.setHeader("Content-Type", "application/x-x509-ca-cert");

    res.send(file);
  } catch (error) {
    console.error(error);
    res.status(500).send("DOWNLOAD_ERROR");
  }
};

export const downloadQztray = async (_req: Request, res: Response): Promise<any> => {
  try {
    const file = await readStoredFileBuffer("impressao/qz-tray-2.2.5-x86_64.exe");

    res.setHeader("Content-Disposition", 'attachment; filename="qztray.exe"');
    res.setHeader("Content-Type", "application/x-msdownload");

    res.send(file);
  } catch (error) {
    console.error(error);
    res.status(500).send("DOWNLOAD_ERROR");
  }
};

export const signKey = async (req: Request, res: Response): Promise<any> => {
  try {
    const privateKey = await readStoredFileBuffer("certificados/private.key");
    const sign = createSign("SHA512");
    sign.update(req.body);
    sign.end();
    const signature = sign.sign(privateKey.toString("utf8"), "base64");
    res.send(signature);
  } catch (error) {
    console.log(error);
    res.status(500).send("SIGN_ERROR");
  }
};
