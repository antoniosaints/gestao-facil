import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./dotenv";

// Cifra simétrica para segredos de terceiros guardados no banco (hoje: tokens OAuth do
// Mercado Pago). Formato: "v1:<iv b64>:<authTag b64>:<ciphertext b64>". Valores sem o
// prefixo são tratados como texto puro (dado legado), então a leitura nunca quebra.
const PREFIX = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function getKey(): Buffer {
  const key = env.MP_OAUTH_ENC_KEY;
  if (!key) {
    throw new Error(
      "MP_OAUTH_ENC_KEY não configurada: não é possível cifrar/decifrar segredos.",
    );
  }
  return Buffer.from(key, "hex");
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(`${PREFIX}:`);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(value: string): string {
  if (!isEncryptedSecret(value)) {
    return value;
  }

  const [, ivB64, authTagB64, ciphertextB64] = value.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Segredo cifrado em formato inválido.");
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
