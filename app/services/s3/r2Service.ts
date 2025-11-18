// presign.js
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../utils/dotenv";
import { r2Storage } from "./r2Cliente";

export async function generatePresignedGetUrl(key: string, expiresIn = 60, download = false): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
  });

  if (download) {
      command.input.ResponseContentDisposition = `attachment; filename="${key.split("/").pop()}"`;
  }

  // retorna o URL já assinado
  const url = await getSignedUrl(r2Storage, command, { expiresIn });
  return url;
}
