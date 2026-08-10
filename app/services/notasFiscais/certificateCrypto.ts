import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../../utils/dotenv";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = Buffer.from("GFNF1");

function key() {
  const value = env.FISCAL_CERTIFICATE_ENC_KEY;
  if (!value) {
    throw new Error("FISCAL_CERTIFICATE_ENC_KEY não está configurada. Não é seguro armazenar certificado fiscal sem uma chave exclusiva.");
  }
  return Buffer.from(value, "hex");
}

export function hasFiscalCertificateEncryptionKey() {
  return Boolean(env.FISCAL_CERTIFICATE_ENC_KEY);
}

export function encryptFiscalSecret(value: string) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptFiscalSecret(value: string) {
  const [version, ivB64, tagB64, dataB64] = value.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("Senha de certificado em formato inválido.");
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

// O bucket de arquivos atual é público para imagens. Por isso o PFX/P12 vai cifrado:
// mesmo uma URL descoberta não revela a chave privada do emissor.
export function encryptCertificateBuffer(value: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([PREFIX, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptCertificateBuffer(value: Buffer) {
  if (value.length <= PREFIX.length + IV_BYTES + 16 || !value.subarray(0, PREFIX.length).equals(PREFIX)) {
    throw new Error("Certificado fiscal em formato inválido.");
  }
  const offset = PREFIX.length;
  const decipher = createDecipheriv(ALGORITHM, key(), value.subarray(offset, offset + IV_BYTES));
  decipher.setAuthTag(value.subarray(offset + IV_BYTES, offset + IV_BYTES + 16));
  return Buffer.concat([decipher.update(value.subarray(offset + IV_BYTES + 16)), decipher.final()]);
}
