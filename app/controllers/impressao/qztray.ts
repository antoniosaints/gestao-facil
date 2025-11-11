import { Request, Response } from "express";
import { createSign } from "crypto";
import fs from "fs";
import path from "path";
import { rootPath } from "../../config/path";

const certPath = path.join(rootPath, "cert");
export const getCertificate = (req: Request, res: Response): any => {
  res.type("text/plain").send(fs.readFileSync(path.join(certPath, "public.crt"), "utf8"));
};

export const signKey = (req: Request, res: Response): any => {
  try {
    const privateKey = fs.readFileSync(path.join(certPath, "private.key"), "utf8");
    const sign = createSign("SHA512");
    sign.update(req.body);
    sign.end();
    const signature = sign.sign(privateKey, "base64");
    res.send(signature);
  }catch (error) {
    console.log(error);
    res.status(500).send("SIGN_ERROR");
  }
};
