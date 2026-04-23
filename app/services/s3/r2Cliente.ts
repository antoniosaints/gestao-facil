import { S3Client } from "@aws-sdk/client-s3";
import { env } from "../../utils/dotenv";

const endpoint = env.R2_API_ENDPOINT || env.R2_ENDPOINT;

export const r2Storage = env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET && endpoint
  ? new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

export function getR2StorageOrThrow() {
  if (!r2Storage) {
    throw new Error("Storage S3/R2 não está configurado. Configure R2_* no backend para habilitar uploads remotos.");
  }

  return r2Storage;
}
