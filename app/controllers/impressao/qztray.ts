import { Request, Response } from "express";
import { createSign } from "crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../../utils/dotenv";
import { r2Storage } from "../../services/s3/r2Cliente";

export const getCertificate = async (req: Request, res: Response): Promise<any> => {
  try {
    const conf = new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: "certificados/public.crt"
    })
    const certo = await r2Storage.send(conf);
    if (!certo.Body) return res.status(500).send("CERT_ERROR");
    const buffer = await certo.Body?.transformToByteArray();
    if (!buffer) return res.status(500).send("CERT_ERROR");
    const buffered = Buffer.from(buffer);
  
    res.type("text/plain").send(buffered.toString("utf8"));
  }catch (error) {
    console.log(error);
    res.status(500).send("CERT_ERROR");
  }
};

export const signKey = async (req: Request, res: Response): Promise<any> => {
  try {
     const conf = new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: "certificados/private.key"
    })
    const certo = await r2Storage.send(conf);
    if (!certo.Body) return res.status(500).send("CERT_ERROR");
    const buffer = await certo.Body?.transformToByteArray();
    if (!buffer) return res.status(500).send("CERT_ERROR");
    const keyDecoded = Buffer.from(buffer).toString("utf8");
    const sign = createSign("SHA512");
    sign.update(req.body);
    sign.end();
    const signature = sign.sign(keyDecoded, "base64");
    res.send(signature);
  }catch (error) {
    console.log(error);
    res.status(500).send("SIGN_ERROR");
  }
};
