import { Request, Response } from "express";
import { createSign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { rootPath } from "../../config/path";

const certPath = path.join(rootPath, "cert");
export const publicKey = (req: Request, res: Response): any => {
  const publicKey = fs.readFileSync(
    path.join(certPath, "qz-tray-public-key.pem"),
    "utf8"
  );
  res.type("text/plain").send(publicKey);
};

export const signKey = (req: Request, res: Response): any => {
  const data = req.body.data;
  const key = fs.readFileSync(
    path.join(certPath, "my-private-key.pem"),
    "utf8"
  );
  const pass = fs.readFileSync(
    path.join(certPath, "my-private-key-password.txt"),
    "utf8"
  );
  const signer = createSign("sha1");
  signer.update(data);
  const signature = signer.sign(
    {
      key,
      passphrase: pass,
    },
    "base64"
  );

  res.send(signature);
};
